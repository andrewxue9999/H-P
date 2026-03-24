import GoogleAuthButton from "@/components/google-auth-button";
import TermTypesClient, { type ActiveTab } from "@/components/term-types-client";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigError } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

type CaptionRow = {
  id?: number | string | null;
  caption_id?: number | string | null;
  image_id?: number | string | null;
  imageId?: number | string | null;
  caption?: string | null;
  content?: string | null;
  text?: string | null;
  created_by_user_id?: number | string | null;
  created_datetime_utc?: string | null;
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
  created_by_user_id?: number | string | null;
  created_datetime_utc?: string | null;
  [key: string]: unknown;
};

type VoteRow = {
  caption_id: number | string;
  vote_value: number;
  created_datetime_utc?: string | null;
  modified_datetime_utc?: string | null;
};

type ScoreRow = Record<string, unknown>;

type MemeRow = {
  captionId: number | string;
  captionText: string;
  imageUrl: string;
  imageId: number | string | null;
  createdAt: string | null;
};

type ScoreInfo = {
  score: number | null;
  upvotes: number | null;
  downvotes: number | null;
};

type TermTypesPageProps = {
  searchParams?: Promise<{
    tab?: string | string[];
  }>;
};

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

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

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = asNumber(obj[key]);
    if (value !== null) return value;
  }
  return null;
}

function getCaptionId(row: CaptionRow): number | string | null {
  const id = row.id ?? row.caption_id;
  if (typeof id === "number" && Number.isFinite(id)) return id;
  if (typeof id === "string" && id.trim().length > 0) return id.trim();
  return null;
}

function getCaptionText(row: CaptionRow) {
  const preferredKeys = [
    "content",
    "caption",
    "text",
    "caption_text",
    "captionText",
    "generated_caption",
    "generatedCaption",
    "description",
    "prompt",
    "title",
    "name",
  ];

  for (const key of preferredKeys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  const ignoredKeys = new Set([
    "id",
    "caption_id",
    "image_id",
    "imageId",
    "created_by_user_id",
    "modified_by_user_id",
    "created_datetime_utc",
    "modified_datetime_utc",
    "url",
    "image_url",
    "cdn_url",
  ]);

  let bestCandidate: string | null = null;

  for (const [key, rawValue] of Object.entries(row)) {
    if (ignoredKeys.has(key)) continue;
    if (typeof rawValue !== "string") continue;

    const value = rawValue.trim();
    if (value.length < 4) continue;
    if (/^https?:\/\//i.test(value)) continue;
    if (/^[0-9a-f-]{24,}$/i.test(value)) continue;

    if (!bestCandidate || value.length > bestCandidate.length) {
      bestCandidate = value;
    }
  }

  if (bestCandidate) return bestCandidate;
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

async function resolveActorProfileId(supabase: SupabaseClient, authUserId: string) {
  const lookupColumns = ["id", "user_id", "auth_user_id", "supabase_user_id"] as const;

  for (const column of lookupColumns) {
    const { data, error } = await supabase.from("profiles").select("id").eq(column, authUserId).maybeSingle();

    if (error) {
      // Keep trying common auth linkage columns until one works.
      continue;
    }

    if (data?.id !== null && data?.id !== undefined) {
      return String(data.id);
    }
  }

  throw new Error("Could not resolve the signed-in user to a profiles.id value.");
}

async function loadScores(
  supabase: SupabaseClient,
  captionIds: string[],
): Promise<{ map: Map<string, ScoreInfo>; error: string | null }> {
  const scoreMap = new Map<string, ScoreInfo>();
  if (captionIds.length === 0) {
    return { map: scoreMap, error: null };
  }

  const scoreTables = ["caption_scores", "caption_score"];
  for (const tableName of scoreTables) {
    let failed = false;
    let failureMessage: string | null = null;

    for (const chunk of chunkIds(captionIds, 150)) {
      const { data, error } = await supabase.from(tableName).select("*").in("caption_id", chunk);
      if (error) {
        failed = true;
        failureMessage = error.message;
        break;
      }

      for (const row of (data ?? []) as ScoreRow[]) {
        const captionId = row.caption_id;
        if (captionId === null || captionId === undefined) continue;
        const captionKey = String(captionId);

        const score = pickNumber(row, ["score", "global_score", "total_score", "net_score", "value"]);
        const upvotes = pickNumber(row, [
          "upvotes",
          "upvote_count",
          "up_votes",
          "positive_votes",
          "positive_count",
        ]);
        const downvotes = pickNumber(row, [
          "downvotes",
          "downvote_count",
          "down_votes",
          "negative_votes",
          "negative_count",
        ]);

        scoreMap.set(captionKey, {
          score,
          upvotes,
          downvotes,
        });
      }
    }

    if (!failed) {
      return { map: scoreMap, error: null };
    }

    if (failed && tableName === scoreTables[scoreTables.length - 1] && failureMessage) {
      scoreMap.clear();
    }
  }

  // Fallback: aggregate directly from votes when score table names are unavailable.
  for (const chunk of chunkIds(captionIds, 150)) {
    const { data, error } = await supabase
      .from("caption_votes")
      .select("caption_id, vote_value")
      .in("caption_id", chunk);

    if (error) {
      return { map: new Map<string, ScoreInfo>(), error: error.message };
    }

    for (const row of (data ?? []) as VoteRow[]) {
      const captionKey = String(row.caption_id);
      const current = scoreMap.get(captionKey) ?? { score: 0, upvotes: 0, downvotes: 0 };
      const vote = asNumber(row.vote_value) ?? 0;
      const upvotes = current.upvotes ?? 0;
      const downvotes = current.downvotes ?? 0;
      const score = current.score ?? 0;

      if (vote > 0) {
        scoreMap.set(captionKey, { score: score + 1, upvotes: upvotes + 1, downvotes });
      } else if (vote < 0) {
        scoreMap.set(captionKey, { score: score - 1, upvotes, downvotes: downvotes + 1 });
      }
    }
  }

  return { map: scoreMap, error: null };
}

function parseTab(value: string | string[] | undefined): ActiveTab {
  const tabValue = Array.isArray(value) ? value[0] : value;
  if (tabValue === "history") return "history";
  if (tabValue === "popular") return "popular";
  if (tabValue === "controversial") return "controversial";
  if (tabValue === "upload") return "upload";
  return "main";
}

function toStableTimestamp(value: string | null) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function TermTypesPage({ searchParams }: TermTypesPageProps) {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <h1 className="text-2xl font-semibold text-slate-900">Caption Ratings</h1>
        <p className="mt-4 text-sm text-red-600">{supabaseConfigError}</p>
      </main>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-8">
        <section className="w-full max-w-lg rounded-2xl border border-sky-100 bg-white p-8 text-center shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Protected Route</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Caption Ratings</h1>
          <p className="mt-3 text-sm text-slate-600">
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
      <main className="min-h-screen bg-slate-50 p-8">
        <h1 className="text-2xl font-semibold text-slate-900">Caption Ratings</h1>
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
      imageId,
      createdAt:
        typeof row.created_datetime_utc === "string" && row.created_datetime_utc.trim().length > 0
          ? row.created_datetime_utc
          : null,
    });
  }

  const captionIds = memes.map((meme) => String(meme.captionId));

  let actorProfileId: string | null = null;
  let actorProfileError: string | null = null;

  try {
    actorProfileId = await resolveActorProfileId(supabase, user.id);
  } catch (error) {
    actorProfileError = error instanceof Error ? error.message : "Could not resolve your profile.";
  }

  const { data: voteData, error: voteError } = actorProfileId
    ? await supabase
        .from("caption_votes")
        .select("caption_id, vote_value, created_datetime_utc, modified_datetime_utc")
        .eq("profile_id", actorProfileId)
    : { data: null, error: null };

  const userVoteMap = new Map<string, number>();
  const voteTimestampMap = new Map<string, string | null>();
  if (!voteError) {
    for (const vote of (voteData ?? []) as VoteRow[]) {
      const parsedVote = asNumber(vote.vote_value);
      if (parsedVote === null) continue;
      const captionKey = String(vote.caption_id);
      userVoteMap.set(captionKey, parsedVote);
      voteTimestampMap.set(captionKey, vote.modified_datetime_utc ?? vote.created_datetime_utc ?? null);
    }
  }

  const { map: scoreMap, error: scoreError } = await loadScores(supabase, captionIds);

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const activeTab = parseTab(resolvedSearchParams?.tab);
  const savedUploadResults = actorProfileId
    ? (() => {
        const uploads = new Map<
          string,
          {
            uploadedAt: number;
            imageUrl: string;
            captions: CaptionRow[];
          }
        >();

        for (const meme of memes) {
          if (!meme.imageId || !meme.createdAt) continue;

          const captionRow = rows.find((row) => String(getCaptionId(row)) === String(meme.captionId));
          if (!captionRow) continue;

          const captionOwnerId =
            captionRow.created_by_user_id !== null && captionRow.created_by_user_id !== undefined
              ? String(captionRow.created_by_user_id)
              : null;

          if (captionOwnerId !== actorProfileId) {
            continue;
          }

          const uploadKey = String(meme.imageId);
          const uploadedAt = toStableTimestamp(meme.createdAt);
          const existingUpload = uploads.get(uploadKey);
          if (!existingUpload) {
            uploads.set(uploadKey, {
              uploadedAt,
              imageUrl: meme.imageUrl,
              captions: [captionRow],
            });
            continue;
          }

          existingUpload.captions.push(captionRow);
          existingUpload.uploadedAt = Math.max(existingUpload.uploadedAt, uploadedAt);
        }

        return Array.from(uploads.values()).sort((left, right) => right.uploadedAt - left.uploadedAt);
      })()
    : [];

  return (
    <TermTypesClient
      activeTab={activeTab}
      actorProfileError={actorProfileError}
      actorProfileId={actorProfileId}
      imageLookupError={imageLookupError}
      initialScores={Array.from(scoreMap.entries()).map(([captionId, info]) => ({
        captionId,
        score: info.score,
        upvotes: info.upvotes,
        downvotes: info.downvotes,
      }))}
      initialVotes={Array.from(userVoteMap.entries()).map(([captionId, voteValue]) => ({
        captionId,
        ratedAt: voteTimestampMap.get(captionId) ?? null,
        voteValue,
      }))}
      memes={memes.map((meme) => ({
        captionId: String(meme.captionId),
        captionText: meme.captionText,
        imageUrl: meme.imageUrl,
      }))}
      savedUploadResults={savedUploadResults}
      scoreError={scoreError}
      userEmail={user.email ?? null}
      voteError={voteError?.message ?? null}
    />
  );
}
