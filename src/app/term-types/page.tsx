import GoogleAuthButton from "@/components/google-auth-button";
import SignOutButton from "@/components/sign-out-button";
import UploadCaptionForm from "@/components/upload-caption-form";
import DelayedSubmitButton from "@/components/delayed-submit-button";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigError } from "@/lib/supabase/env";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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

type MemeRow = {
  captionId: number | string;
  captionText: string;
  imageUrl: string;
};

type TermTypesPageProps = {
  searchParams?: Promise<{
    idx?: string | string[];
  }>;
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

export default async function TermTypesPage({ searchParams }: TermTypesPageProps) {
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
    const nextIndexRaw = formData.get("nextIndex");

    if (typeof captionIdRaw !== "string" || captionIdRaw.trim().length === 0) {
      throw new Error("Invalid caption id.");
    }

    if (voteRaw !== "up" && voteRaw !== "down") {
      throw new Error("Invalid vote value.");
    }
    const nextIndexText =
      typeof nextIndexRaw === "string" && /^\d+$/.test(nextIndexRaw.trim())
        ? nextIndexRaw.trim()
        : "0";

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
    redirect(`/term-types?idx=${nextIndexText}`);
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

  const memes: MemeRow[] = [];
  for (const row of rows) {
    const captionId = getCaptionId(row);
    if (captionId === null) continue;

    const captionText = getCaptionText(row) ?? "Caption unavailable.";
    const imageId = getImageId(row);
    const imageUrl = imageId ? imageMap.get(String(imageId)) ?? getImageUrl(row) : getImageUrl(row);
    if (!imageUrl) continue;

    memes.push({
      captionId,
      captionText,
      imageUrl,
    });
  }

  if (memes.length === 0) {
    return (
      <main className="min-h-screen p-8">
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Caption Ratings</h1>
            <p className="mt-1 text-xs text-gray-500">Signed in as {user.email}</p>
          </div>
          <SignOutButton />
        </div>
        <div className="mt-6 space-y-3">
          <UploadCaptionForm />
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            No caption+image pairs are currently available.
          </p>
          {imageLookupError ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Could not load image rows from the database: {imageLookupError}
            </p>
          ) : null}
        </div>
      </main>
    );
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const idxValue = resolvedSearchParams?.idx;
  const idxParam = Array.isArray(idxValue) ? idxValue[0] : idxValue;
  const parsedIndex = idxParam && /^\d+$/.test(idxParam) ? Number(idxParam) : 0;
  const currentIndex = Number.isFinite(parsedIndex) ? parsedIndex % memes.length : 0;
  const safeCurrentIndex = currentIndex < 0 ? 0 : currentIndex;
  const nextIndex = (safeCurrentIndex + 1) % memes.length;
  const currentMeme = memes[safeCurrentIndex];

  const { data: voteData } = await supabase
    .from("caption_votes")
    .select("caption_id, vote_value")
    .eq("profile_id", user.id)
    .eq("caption_id", currentMeme.captionId)
    .limit(1);

  const existingVoteRow = (voteData ?? []) as VoteRow[];
  const currentVote = existingVoteRow.length > 0 ? existingVoteRow[0].vote_value : undefined;

  return (
    <main className="min-h-screen p-8">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Caption Ratings</h1>
          <p className="mt-1 text-xs text-gray-500">Signed in as {user.email}</p>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-xs text-gray-500">
            Meme {safeCurrentIndex + 1} of {memes.length}
          </p>
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

        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <img
            alt={`Caption image ${safeCurrentIndex + 1}`}
            className="mb-3 max-h-72 w-full rounded-md object-contain"
            src={currentMeme.imageUrl}
          />

          <p className="text-sm text-gray-900">{currentMeme.captionText}</p>
          {typeof currentVote === "number" ? (
            <p className="mt-2 text-xs text-gray-500">
              Your current vote: {currentVote > 0 ? "Upvote" : "Downvote"}
            </p>
          ) : null}

          <div className="mt-3 flex items-center gap-2">
            <form action={submitVote}>
              <input name="captionId" type="hidden" value={String(currentMeme.captionId)} />
              <input name="nextIndex" type="hidden" value={String(nextIndex)} />
              <input name="voteValue" type="hidden" value="up" />
              <DelayedSubmitButton
                className="rounded-md border border-green-300 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-60"
                idleLabel="Upvote"
                pendingLabel="Upvoting..."
              />
            </form>

            <form action={submitVote}>
              <input name="captionId" type="hidden" value={String(currentMeme.captionId)} />
              <input name="nextIndex" type="hidden" value={String(nextIndex)} />
              <input name="voteValue" type="hidden" value="down" />
              <DelayedSubmitButton
                className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                idleLabel="Downvote"
                pendingLabel="Downvoting..."
              />
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
