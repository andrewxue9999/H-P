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

type ScoreRow = Record<string, unknown>;

type MemeRow = {
  captionId: number | string;
  captionText: string;
  imageUrl: string;
};

type ScoreInfo = {
  score: number | null;
  upvotes: number | null;
  downvotes: number | null;
};

type ActiveTab = "main" | "history" | "popular" | "controversial";

type TermTypesPageProps = {
  searchParams?: Promise<{
    tab?: string | string[];
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

function normalizeCaptionId(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Invalid caption id.");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Invalid caption id.");
  }

  const numericCaptionId = Number(trimmed);
  if (Number.isInteger(numericCaptionId) && numericCaptionId > 0) {
    return numericCaptionId;
  }

  return trimmed;
}

async function loadScores(
  supabase: Awaited<ReturnType<typeof createClient>>,
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
  return "main";
}

function tabHref(tab: ActiveTab) {
  return `/term-types?tab=${tab}`;
}

function formatRatio(scoreInfo: ScoreInfo | undefined) {
  if (!scoreInfo) return "0 / 0";
  const upvotes = scoreInfo.upvotes ?? 0;
  const downvotes = scoreInfo.downvotes ?? 0;
  return `${upvotes} / ${downvotes}`;
}

function formatScore(scoreInfo: ScoreInfo | undefined) {
  if (!scoreInfo || scoreInfo.score === null) return "0";
  return String(scoreInfo.score);
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

  async function upsertVote(formData: FormData) {
    "use server";

    const serverSupabase = await createClient();
    const {
      data: { user: authUser },
    } = await serverSupabase.auth.getUser();

    if (!authUser) {
      throw new Error("You must be signed in to vote.");
    }

    const captionId = normalizeCaptionId(formData.get("captionId"));
    const voteRaw = formData.get("voteValue");
    const returnTabRaw = formData.get("returnTab");
    const returnTab =
      returnTabRaw === "history" ||
      returnTabRaw === "popular" ||
      returnTabRaw === "controversial" ||
      returnTabRaw === "main"
        ? returnTabRaw
        : "main";

    if (voteRaw !== "up" && voteRaw !== "down") {
      throw new Error("Invalid vote value.");
    }

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
    redirect(tabHref(returnTab));
  }

  async function clearVote(formData: FormData) {
    "use server";

    const serverSupabase = await createClient();
    const {
      data: { user: authUser },
    } = await serverSupabase.auth.getUser();

    if (!authUser) {
      throw new Error("You must be signed in to update your vote.");
    }

    const captionId = normalizeCaptionId(formData.get("captionId"));
    const returnTabRaw = formData.get("returnTab");
    const returnTab =
      returnTabRaw === "history" ||
      returnTabRaw === "popular" ||
      returnTabRaw === "controversial" ||
      returnTabRaw === "main"
        ? returnTabRaw
        : "history";

    const { error } = await serverSupabase
      .from("caption_votes")
      .delete()
      .eq("profile_id", authUser.id)
      .eq("caption_id", captionId);

    if (error) {
      throw new Error(error.message);
    }

    revalidatePath("/term-types");
    redirect(tabHref(returnTab));
  }

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
    });
  }

  const captionIds = memes.map((meme) => String(meme.captionId));

  const { data: voteData, error: voteError } = await supabase
    .from("caption_votes")
    .select("caption_id, vote_value")
    .eq("profile_id", user.id);

  const userVoteMap = new Map<string, number>();
  if (!voteError) {
    for (const vote of (voteData ?? []) as VoteRow[]) {
      const parsedVote = asNumber(vote.vote_value);
      if (parsedVote === null) continue;
      userVoteMap.set(String(vote.caption_id), parsedVote);
    }
  }

  const { map: scoreMap, error: scoreError } = await loadScores(supabase, captionIds);

  const unseenMemes = memes.filter((meme) => !userVoteMap.has(String(meme.captionId)));
  const historyMemes = memes.filter((meme) => userVoteMap.has(String(meme.captionId)));
  const popularMemes = [...memes].sort((left, right) => {
    const leftInfo = scoreMap.get(String(left.captionId));
    const rightInfo = scoreMap.get(String(right.captionId));
    const leftUpvotes = leftInfo?.upvotes ?? 0;
    const rightUpvotes = rightInfo?.upvotes ?? 0;
    if (rightUpvotes !== leftUpvotes) return rightUpvotes - leftUpvotes;

    const leftScore = leftInfo?.score ?? 0;
    const rightScore = rightInfo?.score ?? 0;
    return rightScore - leftScore;
  });
  const controversialMemes = [...memes].sort((left, right) => {
    const leftInfo = scoreMap.get(String(left.captionId));
    const rightInfo = scoreMap.get(String(right.captionId));
    const leftDownvotes = leftInfo?.downvotes ?? 0;
    const rightDownvotes = rightInfo?.downvotes ?? 0;
    if (rightDownvotes !== leftDownvotes) return rightDownvotes - leftDownvotes;

    const leftScore = leftInfo?.score ?? 0;
    const rightScore = rightInfo?.score ?? 0;
    return leftScore - rightScore;
  });

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const activeTab = parseTab(resolvedSearchParams?.tab);
  const mainMeme = unseenMemes[0];

  const renderMemeCard = (meme: MemeRow, returnTab: ActiveTab, showCurrentVote: boolean) => {
    const captionKey = String(meme.captionId);
    const currentVote = userVoteMap.get(captionKey);
    const scoreInfo = scoreMap.get(captionKey);

    return (
      <section className="rounded-2xl border border-sky-100 bg-white p-4 shadow-sm" key={captionKey}>
        <img
          alt="Meme image"
          className="mb-4 max-h-80 w-full rounded-xl border border-slate-100 object-contain"
          src={meme.imageUrl}
        />

        <p className="text-base leading-relaxed text-slate-900">{meme.captionText}</p>
        {showCurrentVote && typeof currentVote === "number" ? (
          <p className="mt-2 text-xs text-slate-500">
            Your vote: {currentVote > 0 ? "Upvote" : "Downvote"}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <form action={upsertVote}>
            <input name="captionId" type="hidden" value={captionKey} />
            <input name="returnTab" type="hidden" value={returnTab} />
            <input name="voteValue" type="hidden" value="up" />
            <DelayedSubmitButton
              className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
              idleLabel="Upvote"
              pendingLabel="Saving..."
            />
          </form>

          <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
            {formatScore(scoreInfo)}
          </span>

          <form action={upsertVote}>
            <input name="captionId" type="hidden" value={captionKey} />
            <input name="returnTab" type="hidden" value={returnTab} />
            <input name="voteValue" type="hidden" value="down" />
            <DelayedSubmitButton
              className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
              idleLabel="Downvote"
              pendingLabel="Saving..."
            />
          </form>

          <span className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700">
            Up/Downvote Ratio {formatRatio(scoreInfo)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {showCurrentVote ? (
            <form action={clearVote}>
              <input name="captionId" type="hidden" value={captionKey} />
              <input name="returnTab" type="hidden" value={returnTab} />
              <DelayedSubmitButton
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                idleLabel="Unrate"
                pendingLabel="Updating..."
              />
            </form>
          ) : null}
        </div>
      </section>
    );
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-50 via-violet-50 to-white">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col md:flex-row">
        <aside className="border-b border-sky-100 bg-white px-5 py-6 md:min-h-screen md:w-72 md:border-b-0 md:border-r">
          <p className="text-xs uppercase tracking-wide text-violet-700">Caption Ratings</p>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">Meme Voting</h1>
          <p className="mt-1 text-xs text-slate-500">{user.email}</p>

          <nav className="mt-6 space-y-2">
            <a
              className={`block rounded-xl px-3 py-2 text-sm font-medium ${
                activeTab === "main"
                  ? "bg-violet-100 text-violet-800"
                  : "bg-slate-50 text-slate-700 hover:bg-violet-50"
              }`}
              href={tabHref("main")}
            >
              Main
            </a>
            <a
              className={`block rounded-xl px-3 py-2 text-sm font-medium ${
                activeTab === "history"
                  ? "bg-violet-100 text-violet-800"
                  : "bg-slate-50 text-slate-700 hover:bg-violet-50"
              }`}
              href={tabHref("history")}
            >
              View History
            </a>
            <a
              className={`block rounded-xl px-3 py-2 text-sm font-medium ${
                activeTab === "popular"
                  ? "bg-violet-100 text-violet-800"
                  : "bg-slate-50 text-slate-700 hover:bg-violet-50"
              }`}
              href={tabHref("popular")}
            >
              Popular
            </a>
            <a
              className={`block rounded-xl px-3 py-2 text-sm font-medium ${
                activeTab === "controversial"
                  ? "bg-violet-100 text-violet-800"
                  : "bg-slate-50 text-slate-700 hover:bg-violet-50"
              }`}
              href={tabHref("controversial")}
            >
              Controversial
            </a>
          </nav>

          <div className="mt-6 rounded-xl border border-violet-100 bg-violet-50 p-3 text-xs text-slate-700">
            <p>Unrated in main: {unseenMemes.length}</p>
            <p className="mt-1">Rated in history: {historyMemes.length}</p>
            <p className="mt-1">Total memes: {memes.length}</p>
          </div>

          <div className="mt-6">
            <SignOutButton />
          </div>
        </aside>

        <section className="flex-1 p-5 md:p-8">
          <UploadCaptionForm />

          <div className="mt-4 space-y-2">
            {imageLookupError ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Could not load image rows: {imageLookupError}
              </p>
            ) : null}
            {voteError ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Could not load your vote history: {voteError.message}
              </p>
            ) : null}
            {scoreError ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Could not load score table; showing fallback where possible: {scoreError}
              </p>
            ) : null}
          </div>

          {activeTab === "main" ? (
            <div className="mt-5">
              <h2 className="text-lg font-semibold text-slate-900">Main Feed (Unseen/Unrated)</h2>
              <p className="mt-1 text-sm text-slate-600">Upvote/downvote moves to the next meme.</p>

              <div className="mt-4">
                {mainMeme ? (
                  renderMemeCard(mainMeme, "main", false)
                ) : (
                  <section className="rounded-2xl border border-sky-100 bg-white p-6 text-sm text-slate-700 shadow-sm">
                    You have rated every available meme. Use View History to change ratings or unrate.
                  </section>
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "history" ? (
            <div className="mt-5">
              <h2 className="text-lg font-semibold text-slate-900">View History</h2>
              <p className="mt-1 text-sm text-slate-600">
                Rated memes only. You can re-rate them or unrate to return them to the main feed.
              </p>
              <div className="mt-4 space-y-4">
                {historyMemes.length > 0 ? (
                  historyMemes.map((meme) => renderMemeCard(meme, "history", true))
                ) : (
                  <section className="rounded-2xl border border-sky-100 bg-white p-6 text-sm text-slate-700 shadow-sm">
                    No rated memes yet.
                  </section>
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "popular" ? (
            <div className="mt-5">
              <h2 className="text-lg font-semibold text-slate-900">Popular</h2>
              <p className="mt-1 text-sm text-slate-600">
                Most liked memes first, regardless of whether you have already voted on them.
              </p>
              <div className="mt-4 space-y-4">
                {popularMemes.length > 0 ? (
                  popularMemes.map((meme) =>
                    renderMemeCard(meme, "popular", userVoteMap.has(String(meme.captionId))),
                  )
                ) : (
                  <section className="rounded-2xl border border-sky-100 bg-white p-6 text-sm text-slate-700 shadow-sm">
                    No memes available.
                  </section>
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "controversial" ? (
            <div className="mt-5">
              <h2 className="text-lg font-semibold text-slate-900">Controversial</h2>
              <p className="mt-1 text-sm text-slate-600">
                Most downvoted memes first, regardless of whether you have already seen them.
              </p>
              <div className="mt-4 space-y-4">
                {controversialMemes.length > 0 ? (
                  controversialMemes.map((meme) =>
                    renderMemeCard(meme, "controversial", userVoteMap.has(String(meme.captionId))),
                  )
                ) : (
                  <section className="rounded-2xl border border-sky-100 bg-white p-6 text-sm text-slate-700 shadow-sm">
                    No memes available.
                  </section>
                )}
              </div>
            </div>
          ) : null}

        </section>
      </div>
    </main>
  );
}
