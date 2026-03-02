"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
  imageUrl: string;
  captions: CaptionRecord[];
};

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

export default function UploadCaptionForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedResult | null>(null);

  const accept = useMemo(() => Array.from(SUPPORTED_TYPES).join(","), []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!file) {
      setError("Choose an image file first.");
      return;
    }

    if (!SUPPORTED_TYPES.has(file.type)) {
      setError(`Unsupported content type: ${file.type || "unknown"}`);
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const token = session?.access_token;
      if (!token) {
        throw new Error("You must be signed in to upload images.");
      }

      const presignResponse = await fetch(`${API_BASE_URL}/pipeline/generate-presigned-url`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ contentType: file.type }),
      });
      const presignJson = await presignResponse.json();
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

      const uploadResponse = await fetch(presignedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
        },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status ${uploadResponse.status}.`);
      }

      const registerResponse = await fetch(`${API_BASE_URL}/pipeline/upload-image-from-url`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageUrl: cdnUrl,
          isCommonUse: false,
        }),
      });
      const registerJson = await registerResponse.json();
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

      const captionResponse = await fetch(`${API_BASE_URL}/pipeline/generate-captions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageId,
        }),
      });
      const captionJson = await captionResponse.json();
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

      setResult({
        imageUrl: cdnUrl,
        captions,
      });

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to upload image.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900">Upload Image and Generate Captions</h2>
      <p className="mt-1 text-xs text-gray-600">
        This runs: presign URL, upload bytes, register image URL, then generate captions.
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

      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}

      {result ? (
        <div className="mt-4 rounded-md border border-gray-200 p-3">
          <img
            alt="Uploaded meme"
            className="max-h-72 w-full rounded-md object-contain"
            src={result.imageUrl}
          />
          <div className="mt-3 space-y-2">
            {result.captions.length > 0 ? (
              result.captions.map((caption, index) => (
                <p className="text-sm text-gray-800" key={`generated-${caption.id ?? index}`}>
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
      ) : null}
    </section>
  );
}
