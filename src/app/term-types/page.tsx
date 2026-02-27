import GoogleAuthButton from "@/components/google-auth-button";
import SignOutButton from "@/components/sign-out-button";
import UploadCaptionForm from "@/components/upload-caption-form";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigError } from "@/lib/supabase/env";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

type CaptionRow = {
  id?: number | string | null;
  caption_id?: number | string | null;
  image_id?: number | string | null;
  imageId?: number | string | null;
  caption?: string | null;
  content?: string | null;
  text?: string | null;
  image_url?: string | null;
  cdn_url?: string | null;
  url?: string | null;
  [key: string]: unknown;
};

type ImageRow = {
  id?: number | string | null;
  url?: string | null;
  image_url?: string | null;
  cdn_url?: string | null;
  [key: string]: unknown;
};

type VoteRow = {
  caption_id: number | string;
  vote_value: number;
};

function uniqueIds(ids: Array<number | string>) {
  return Array.from(new Set(ids.map((id) => String(id))));
}

function chunkIds(ids: string[], size: number) {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

function getCaptionId(row: CaptionRow): number | string | null {
  const id = row.id ?? row.caption_id;
  if (typeof id === "number" && Number.isFinite(id)) return id;
  if (typeof id === "string" && id.trim().length > 0) return id.trim();
  return null;
}

function getCaptionText(row: CaptionRow) {
  const value = row.content ?? row.caption ?? row.text;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

function getImageId(row: CaptionRow): number | string | null {
  const value = row.image_id ?? row.imageId;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

function getImageUrl(row: CaptionRow | ImageRow) {
  const value = row.url ?? row.image_url ?? row.cdn_url;
  if (typeof value !== "string" || value.trim().length === 0) return null;

  const trimmed = value.trim();

  // Vercel pages are served over HTTPS, so HTTP image URLs can be blocked as mixed content.
  if (trimmed.startsWith("http://")) {
    return `https://${trimmed.slice("http://".length)}`;
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  if (trimmed.startsWith("/")) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.toString();
  } catch {
    return encodeURI(trimmed);
  }
}

export default async function TermTypesPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <main className="min-h-screen p-8">
        <h1 className="text-2xl font-semibold">Caption Ratings</h1>
        <p className="mt-4 text-sm text-red-600">{supabaseConfigError}</p>
      </main>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  async function submitVote(formData: FormData) {
    "use server";

    const serverSupabase = await createClient();
    const {
      data: { user: authUser },
    } = await serverSupabase.auth.getUser();

    if (!authUser) {
      throw new Error("You must be signed in to vote.");
    }

    const captionIdRaw = formData.get("captionId");
    const voteRaw = formData.get("voteValue");

    if (typeof captionIdRaw !== "string" || captionIdRaw.trim().length === 0) {
      throw new Error("Invalid caption id.");
    }

    if (voteRaw !== "up" && voteRaw !== "down") {
      throw new Error("Invalid vote value.");
    }

    const captionIdText = captionIdRaw.trim();
    const numericCaptionId = Number(captionIdText);
    const captionId =
      Number.isInteger(numericCaptionId) && numericCaptionId > 0
        ? numericCaptionId
        : captionIdText;

    const voteValue = voteRaw === "up" ? 1 : -1;
    const nowUtc = new Date().toISOString();

    const { error } = await serverSupabase.from("caption_votes").upsert(
      {
        caption_id: captionId,
        profile_id: authUser.id,
        vote_value: voteValue,
        created_datetime_utc: nowUtc,
        modified_datetime_utc: nowUtc,
      },
      {
        onConflict: "profile_id,caption_id",
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    revalidatePath("/term-types");
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <section className="w-full max-w-lg rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Protected Route</p>
          <h1 className="mt-2 text-2xl font-semibold text-gray-900">Caption Ratings</h1>
          <p className="mt-3 text-sm text-gray-600">
            You must sign in to view captions and submit votes.
          </p>
          <div className="mt-6 flex items-center justify-center">
            <GoogleAuthButton />
          </div>
        </section>
      </main>
    );
  }

  const { data: captionData, error: captionError } = await supabase
    .from("captions")
    .select("*")
    .order("id", { ascending: true });

  if (captionError) {
    return (
      <main className="min-h-screen p-8">
        <h1 className="text-2xl font-semibold">Caption Ratings</h1>
        <p className="mt-4 text-sm text-red-600">{captionError.message}</p>
      </main>
    );
  }

  const rows = (captionData ?? []) as CaptionRow[];
  const captionIds = rows.map(getCaptionId).filter((id): id is number | string => id !== null);
  const imageIds = rows.map(getImageId).filter((id): id is number | string => id !== null);

  const imageMap = new Map<string, string>();
  let imageLookupError: string | null = null;
  if (imageIds.length > 0) {
    const dedupedImageIds = uniqueIds(imageIds);
    const imageIdChunks = chunkIds(dedupedImageIds, 150);

    for (const imageIdChunk of imageIdChunks) {
      const { data: imageData, error: imageError } = await supabase
        .from("images")
        .select("*")
        .in("id", imageIdChunk);

      if (imageError) {
        imageLookupError = imageError.message;
        break;
      }

      for (const row of (imageData ?? []) as ImageRow[]) {
        if (row.id === null || row.id === undefined) continue;
        const imageUrl = getImageUrl(row);
        if (!imageUrl) continue;
        imageMap.set(String(row.id), imageUrl);
      }
    }
  }

  const voteMap = new Map<string, number>();
  if (captionIds.length > 0) {
    const { data: voteData } = await supabase
      .from("caption_votes")
      .select("caption_id, vote_value")
      .eq("profile_id", user.id)
      .in("caption_id", captionIds);

    for (const row of (voteData ?? []) as VoteRow[]) {
      voteMap.set(String(row.caption_id), row.vote_value);
    }
  }

  return (
    <main className="min-h-screen p-8">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Caption Ratings</h1>
          <p className="mt-1 text-xs text-gray-500">Signed in as {user.email}</p>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-xs text-gray-500">{rows.length} captions</p>
          <SignOutButton />
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <UploadCaptionForm />
        {imageLookupError ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Could not load image rows from the database: {imageLookupError}
          </p>
        ) : null}

        {rows.map((row, index) => {
          const captionId = getCaptionId(row);
          const captionText = getCaptionText(row);
          const imageId = getImageId(row);
          const imageUrl = imageId ? imageMap.get(String(imageId)) ?? getImageUrl(row) : getImageUrl(row);
          const currentVote = captionId ? voteMap.get(String(captionId)) : undefined;

          return (
            <section
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
              key={captionId ? `caption-${captionId}` : `caption-row-${index}`}
            >
              {imageUrl ? (
                <img
                  alt={`Caption image ${index + 1}`}
                  className="mb-3 max-h-72 w-full rounded-md object-contain"
                  src={imageUrl}
                />
              ) : (
                <p className="mb-3 text-xs text-amber-700">Image unavailable for this caption.</p>
              )}

              <p className="text-sm text-gray-900">{captionText ?? `Caption #${index + 1}`}</p>
              {typeof currentVote === "number" ? (
                <p className="mt-2 text-xs text-gray-500">
                  Your vote: {currentVote > 0 ? "Upvote" : "Downvote"}
                </p>
              ) : null}

              {captionId ? (
                <div className="mt-3 flex items-center gap-2">
                  <form action={submitVote}>
                    <input name="captionId" type="hidden" value={String(captionId)} />
                    <input name="voteValue" type="hidden" value="up" />
                    <button
                      className="rounded-md border border-green-300 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50"
                      type="submit"
                    >
                      Upvote
                    </button>
                  </form>

                  <form action={submitVote}>
                    <input name="captionId" type="hidden" value={String(captionId)} />
                    <input name="voteValue" type="hidden" value="down" />
                    <button
                      className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                      type="submit"
                    >
                      Downvote
                    </button>
                  </form>
                </div>
              ) : (
                <p className="mt-3 text-xs text-red-600">Missing caption ID, so voting is disabled.</p>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
