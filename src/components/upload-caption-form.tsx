"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isRefreshTokenNotFoundError } from "@/lib/supabase/auth";

const API_BASE_URL = "https://api.almostcrackd.ai";
const SUPPORTED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
]);

type CaptionRecord = {
  id?: number | string | null;
  content?: string | null;
  caption?: string | null;
  text?: string | null;
  [key: string]: unknown;
};

type GeneratedResult = {
  uploadedAt: number;
  imageUrl: string;
  captions: CaptionRecord[];
};

type UploadCaptionFormProps = {
  actorProfileId: string | null;
  savedResults: GeneratedResult[];
};

const LOCAL_RESULTS_STORAGE_KEY = "upload-caption-form-results";

function getCaptionText(row: CaptionRecord) {
  const value = row.content ?? row.caption ?? row.text;
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function parseErrorMessage(statusFallback: string, payload: unknown) {
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload;
  }
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = payload.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }
  return statusFallback;
}

async function readResponsePayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return text.length > 0 ? text : null;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function sleep(delayMs: number) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

async function loadPersistedCaptions(supabase: ReturnType<typeof createClient>, imageId: string) {
  const { data, error } = await supabase.from("captions").select("*").eq("image_id", imageId).order("id");

  if (error) {
    throw error;
  }

  return (data ?? []) as CaptionRecord[];
}

async function verifyPersistedUpload(
  supabase: ReturnType<typeof createClient>,
  imageId: string,
  imageUrl: string,
): Promise<GeneratedResult | null> {
  const { data: imageRow, error: imageError } = await supabase.from("images").select("id").eq("id", imageId).maybeSingle();
  if (imageError) {
    throw imageError;
  }
  if (!imageRow) {
    return null;
  }

  const captions = await loadPersistedCaptions(supabase, imageId);
  if (captions.length === 0) {
    return null;
  }

  return {
    uploadedAt: Date.now(),
    imageUrl,
    captions,
  };
}

async function insertFallbackCaptions(
  supabase: ReturnType<typeof createClient>,
  imageId: string,
  actorProfileId: string,
  captions: CaptionRecord[],
) {
  const normalizedRows = captions
    .map((caption) => getCaptionText(caption))
    .filter((captionText): captionText is string => Boolean(captionText))
    .map((captionText) => ({
      image_id: imageId,
      content: captionText,
      created_by_user_id: actorProfileId,
      modified_by_user_id: actorProfileId,
    }));

  if (normalizedRows.length === 0) {
    return false;
  }

  const { error } = await supabase.from("captions").insert(normalizedRows);
  if (error) {
    return false;
  }

  return true;
}

export default function UploadCaptionForm({ actorProfileId, savedResults }: UploadCaptionFormProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionStage, setSubmissionStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localResults, setLocalResults] = useState<GeneratedResult[]>([]);

  const accept = useMemo(() => Array.from(SUPPORTED_TYPES).join(","), []);
  const results = useMemo(() => {
    const merged = [...localResults];

    for (const result of savedResults) {
      if (merged.some((localResult) => localResult.imageUrl === result.imageUrl)) {
        continue;
      }

      merged.push(result);
    }

    return merged.sort((left, right) => right.uploadedAt - left.uploadedAt);
  }, [localResults, savedResults]);

  useEffect(() => {
    try {
      const storedValue = window.localStorage.getItem(LOCAL_RESULTS_STORAGE_KEY);
      if (!storedValue) {
        return;
      }

      const parsed = JSON.parse(storedValue);
      if (!Array.isArray(parsed)) {
        return;
      }

      const restoredResults = parsed.flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }

        const uploadedAt =
          "uploadedAt" in entry && typeof entry.uploadedAt === "number" && Number.isFinite(entry.uploadedAt)
            ? entry.uploadedAt
            : null;
        const imageUrl =
          "imageUrl" in entry && typeof entry.imageUrl === "string" && entry.imageUrl.trim().length > 0
            ? entry.imageUrl
            : null;
        const captions =
          "captions" in entry && Array.isArray(entry.captions)
            ? entry.captions.filter(
                (caption: unknown): caption is CaptionRecord => Boolean(caption && typeof caption === "object"),
              )
            : [];

        if (uploadedAt === null || imageUrl === null) {
          return [];
        }

        return [
          {
            uploadedAt,
            imageUrl,
            captions,
          },
        ];
      });

      setLocalResults(restoredResults);
    } catch {
      // Ignore malformed client cache and fall back to server-backed results.
    }
  }, []);

  useEffect(() => {
    setLocalResults((previous) =>
      previous.filter(
        (localResult) => !savedResults.some((savedResult) => savedResult.imageUrl === localResult.imageUrl),
      ),
    );
  }, [savedResults]);

  useEffect(() => {
    try {
      if (localResults.length === 0) {
        window.localStorage.removeItem(LOCAL_RESULTS_STORAGE_KEY);
        return;
      }

      window.localStorage.setItem(LOCAL_RESULTS_STORAGE_KEY, JSON.stringify(localResults));
    } catch {
      // Ignore storage write failures; the UI can still rely on in-memory state.
    }
  }, [localResults]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!file) {
      setError("Choose an image file first.");
      return;
    }

    if (!SUPPORTED_TYPES.has(file.type)) {
      setError(`Unsupported content type: ${file.type || "unknown"}`);
      return;
    }

    setIsSubmitting(true);
    setSubmissionStage("Checking your session...");

    try {
      const supabase = createClient();
      let session = null;

      try {
        const sessionResult = await supabase.auth.getSession();
        session = sessionResult.data.session;
      } catch (sessionError) {
        if (isRefreshTokenNotFoundError(sessionError)) {
          await supabase.auth.signOut({ scope: "local" });
          throw new Error("Your session expired. Sign in again and retry the upload.");
        }

        throw sessionError;
      }

      const token = session?.access_token;
      if (!token) {
        throw new Error("You must be signed in to upload images.");
      }

      setSubmissionStage("Preparing secure upload...");
      const presignResponse = await fetchWithTimeout(
        `${API_BASE_URL}/pipeline/generate-presigned-url`,
        {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ contentType: file.type }),
        },
        15000,
      );
      const presignJson = await readResponsePayload(presignResponse);
      if (!presignResponse.ok) {
        throw new Error(parseErrorMessage("Failed to generate upload URL.", presignJson));
      }

      const presignedUrl =
        presignJson && typeof presignJson === "object" && "presignedUrl" in presignJson
          ? presignJson.presignedUrl
          : null;
      const cdnUrl =
        presignJson && typeof presignJson === "object" && "cdnUrl" in presignJson
          ? presignJson.cdnUrl
          : null;

      if (typeof presignedUrl !== "string" || typeof cdnUrl !== "string") {
        throw new Error("Upload URL response is missing required fields.");
      }

      setSubmissionStage("Uploading image...");
      const uploadResponse = await fetchWithTimeout(
        presignedUrl,
        {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
        },
        body: file,
        },
        120000,
      );
      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status ${uploadResponse.status}.`);
      }

      setSubmissionStage("Saving image record...");
      const registerResponse = await fetchWithTimeout(
        `${API_BASE_URL}/pipeline/upload-image-from-url`,
        {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageUrl: cdnUrl,
          isCommonUse: false,
        }),
        },
        30000,
      );
      const registerJson = await readResponsePayload(registerResponse);
      if (!registerResponse.ok) {
        throw new Error(parseErrorMessage("Failed to register uploaded image.", registerJson));
      }

      const imageId =
        registerJson && typeof registerJson === "object" && "imageId" in registerJson
          ? registerJson.imageId
          : null;
      if (typeof imageId !== "string" || imageId.trim().length === 0) {
        throw new Error("Image registration did not return a valid imageId.");
      }

      setSubmissionStage("Generating captions...");
      const captionResponse = await fetchWithTimeout(
        `${API_BASE_URL}/pipeline/generate-captions`,
        {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageId,
        }),
        },
        120000,
      );
      const captionJson = await readResponsePayload(captionResponse);
      if (!captionResponse.ok) {
        throw new Error(parseErrorMessage("Failed to generate captions.", captionJson));
      }

      const captions = Array.isArray(captionJson)
        ? (captionJson as CaptionRecord[])
        : captionJson &&
            typeof captionJson === "object" &&
            "captions" in captionJson &&
            Array.isArray(captionJson.captions)
          ? (captionJson.captions as CaptionRecord[])
          : [];

      setSubmissionStage("Finalizing results...");
      let verifiedResult: GeneratedResult | null = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        verifiedResult = await verifyPersistedUpload(supabase, imageId, cdnUrl);
        if (verifiedResult) break;
        await sleep(300);
      }

      if (!verifiedResult && actorProfileId && captions.length > 0) {
        const inserted = await insertFallbackCaptions(supabase, imageId, actorProfileId, captions);
        if (inserted) {
          verifiedResult = await verifyPersistedUpload(supabase, imageId, cdnUrl);
        }
      }

      if (!verifiedResult) {
        throw new Error("Upload completed, but the generated meme was not persisted to Supabase.");
      }

      setLocalResults((previous) => [
        verifiedResult,
        ...previous.filter((result) => result.imageUrl !== cdnUrl),
      ]);
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setSubmissionStage(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Upload or caption generation timed out. Retry the request.");
      } else {
        setError(err instanceof Error ? err.message : "Unable to upload image.");
      }
      setSubmissionStage(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900">Upload Image and Generate Captions</h2>
      <p className="mt-1 text-xs text-gray-600">
        Choose an image, then generate captions. Progress appears below while the request runs.
      </p>

      <form className="mt-4 flex flex-wrap items-center gap-3" onSubmit={handleSubmit}>
        <label
          className="cursor-pointer rounded-md border border-gray-400 bg-gray-100 px-3 py-2 text-xs font-medium text-gray-800 hover:bg-gray-200"
          htmlFor="meme-upload-file"
        >
          Choose File
        </label>
        <input
          accept={accept}
          className="sr-only"
          id="meme-upload-file"
          ref={fileInputRef}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          type="file"
        />
        <span className="max-w-full text-xs text-gray-600">
          {file ? file.name : "No file chosen"}
        </span>
        <button
          className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Generating..." : "Upload + Generate"}
        </button>
      </form>

      {submissionStage ? (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-300 border-t-sky-700" />
          <span>{submissionStage}</span>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}

      {results.length > 0 ? (
        <div className="mt-4 space-y-4">
          {results.map((result) => (
            <div className="rounded-md border border-gray-200 p-3" key={`result-${result.uploadedAt}`}>
              <Image
                alt="Uploaded meme"
                className="max-h-72 w-full rounded-md object-contain"
                height={720}
                src={result.imageUrl}
                unoptimized
                width={1280}
              />
              <div className="mt-3 space-y-2">
                {result.captions.length > 0 ? (
                  result.captions.map((caption, index) => (
                    <p
                      className="text-sm text-gray-800"
                      key={`generated-${result.uploadedAt}-${caption.id ?? index}`}
                    >
                      {getCaptionText(caption) ?? `Caption ${index + 1}`}
                    </p>
                  ))
                ) : (
                  <p className="text-xs text-gray-500">
                    Captions were generated, but no caption text was returned in this response.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
