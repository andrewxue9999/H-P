"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import SignOutButton from "@/components/sign-out-button";
import UploadCaptionForm from "@/components/upload-caption-form";
import { createClient } from "@/lib/supabase/client";

export type ActiveTab = "main" | "history" | "popular" | "controversial" | "upload";

type CaptionRecord = {
  id?: number | string | null;
  content?: string | null;
  caption?: string | null;
  text?: string | null;
  [key: string]: unknown;
};

type MemeRow = {
  captionId: string;
  captionText: string;
  imageUrl: string;
};

type ScoreInfo = {
  score: number | null;
  upvotes: number | null;
  downvotes: number | null;
};

type SavedUploadResult = {
  uploadedAt: number;
  imageUrl: string;
  captions: CaptionRecord[];
};

type VoteEntry = {
  captionId: string;
  ratedAt: string | null;
  voteValue: number;
};

type ScoreEntry = {
  captionId: string;
  score: number | null;
  upvotes: number | null;
  downvotes: number | null;
};

type TermTypesClientProps = {
  userEmail: string | null;
  activeTab: ActiveTab;
  actorProfileId: string | null;
  memes: MemeRow[];
  initialVotes: VoteEntry[];
  initialScores: ScoreEntry[];
  savedUploadResults: SavedUploadResult[];
  imageLookupError: string | null;
  voteError: string | null;
  actorProfileError: string | null;
  scoreError: string | null;
};

function normalizeCaptionId(value: string) {
  const trimmed = value.trim();
  const numericValue = Number(trimmed);
  if (Number.isInteger(numericValue) && numericValue > 0) {
    return numericValue;
  }
  return trimmed;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }
  return fallback;
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

function parseTabFromLocation(): ActiveTab {
  const url = new URL(window.location.href);
  const tab = url.searchParams.get("tab");
  if (tab === "history" || tab === "popular" || tab === "controversial" || tab === "upload") {
    return tab;
  }
  return "main";
}

function updateScoreInfo(current: ScoreInfo | undefined, previousVote: number | undefined, nextVote: number | undefined) {
  const next: ScoreInfo = {
    score: current?.score ?? 0,
    upvotes: current?.upvotes ?? 0,
    downvotes: current?.downvotes ?? 0,
  };

  if (previousVote === 1) {
    next.score = (next.score ?? 0) - 1;
    next.upvotes = Math.max(0, (next.upvotes ?? 0) - 1);
  } else if (previousVote === -1) {
    next.score = (next.score ?? 0) + 1;
    next.downvotes = Math.max(0, (next.downvotes ?? 0) - 1);
  }

  if (nextVote === 1) {
    next.score = (next.score ?? 0) + 1;
    next.upvotes = (next.upvotes ?? 0) + 1;
  } else if (nextVote === -1) {
    next.score = (next.score ?? 0) - 1;
    next.downvotes = (next.downvotes ?? 0) + 1;
  }

  return next;
}

function toTimestamp(value: string | null) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function TermTypesClient({
  userEmail,
  activeTab: initialActiveTab,
  actorProfileId,
  memes,
  initialVotes,
  initialScores,
  savedUploadResults,
  imageLookupError,
  voteError,
  actorProfileError,
  scoreError,
}: TermTypesClientProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialActiveTab);
  const [clientError, setClientError] = useState<string | null>(null);
  const [pendingCaptionIds, setPendingCaptionIds] = useState<Record<string, boolean>>({});
  const [skippedCaptionIds, setSkippedCaptionIds] = useState<Record<string, boolean>>({});
  const [voteTimestampMap, setVoteTimestampMap] = useState<Map<string, string | null>>(
    () => new Map(initialVotes.map((vote) => [vote.captionId, vote.ratedAt])),
  );
  const [voteMap, setVoteMap] = useState<Map<string, number>>(
    () => new Map(initialVotes.map((vote) => [vote.captionId, vote.voteValue])),
  );
  const [scoreMap, setScoreMap] = useState<Map<string, ScoreInfo>>(
    () => new Map(initialScores.map((score) => [score.captionId, score])),
  );

  useEffect(() => {
    const handlePopState = () => {
      setActiveTab(parseTabFromLocation());
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    setVoteMap(new Map(initialVotes.map((vote) => [vote.captionId, vote.voteValue])));
  }, [initialVotes]);

  useEffect(() => {
    setVoteTimestampMap(new Map(initialVotes.map((vote) => [vote.captionId, vote.ratedAt])));
  }, [initialVotes]);

  useEffect(() => {
    setScoreMap(new Map(initialScores.map((score) => [score.captionId, score])));
  }, [initialScores]);

  useEffect(() => {
    setSkippedCaptionIds({});
  }, [memes]);

  function handleTabChange(tab: ActiveTab) {
    setActiveTab(tab);
    window.history.pushState({}, "", tabHref(tab));
  }

  async function mutateVote(captionId: string, desiredVote: number | undefined) {
    if (!actorProfileId) {
      setClientError(actorProfileError ?? "Could not resolve your profile row.");
      return;
    }

    if (pendingCaptionIds[captionId]) {
      return;
    }

    setClientError(null);
    const supabase = createClient();
    const normalizedCaptionId = normalizeCaptionId(captionId);
    const previousVote = voteMap.get(captionId);
    const nextVote = previousVote === desiredVote ? undefined : desiredVote;
    const previousVoteMap = new Map(voteMap);
    const previousVoteTimestampMap = new Map(voteTimestampMap);
    const previousScoreMap = new Map(scoreMap);
    const nextVoteMap = new Map(voteMap);
    const nextVoteTimestampMap = new Map(voteTimestampMap);
    const nextScoreMap = new Map(scoreMap);
    const nextRatedAt = new Date().toISOString();

    if (typeof nextVote === "number") {
      nextVoteMap.set(captionId, nextVote);
      nextVoteTimestampMap.set(captionId, nextRatedAt);
    } else {
      nextVoteMap.delete(captionId);
      nextVoteTimestampMap.delete(captionId);
    }

    nextScoreMap.set(captionId, updateScoreInfo(scoreMap.get(captionId), previousVote, nextVote));

    setPendingCaptionIds((previous) => ({ ...previous, [captionId]: true }));
    setVoteMap(nextVoteMap);
    setVoteTimestampMap(nextVoteTimestampMap);
    setScoreMap(nextScoreMap);

    try {
      if (typeof nextVote !== "number") {
        const { error } = await supabase
          .from("caption_votes")
          .delete()
          .eq("profile_id", actorProfileId)
          .eq("caption_id", normalizedCaptionId);

        if (error) throw error;
        return;
      }

      if (typeof previousVote === "number") {
        const { error } = await supabase
          .from("caption_votes")
          .update({
            vote_value: nextVote,
            modified_by_user_id: actorProfileId,
          })
          .eq("profile_id", actorProfileId)
          .eq("caption_id", normalizedCaptionId);

        if (error) throw error;
        return;
      }

      const { error } = await supabase.from("caption_votes").insert({
        caption_id: normalizedCaptionId,
        profile_id: actorProfileId,
        vote_value: nextVote,
        created_by_user_id: actorProfileId,
        modified_by_user_id: actorProfileId,
      });

      if (error) throw error;
    } catch (error) {
      setVoteMap(previousVoteMap);
      setVoteTimestampMap(previousVoteTimestampMap);
      setScoreMap(previousScoreMap);
      setClientError(getErrorMessage(error, "Could not update your vote."));
    } finally {
      setPendingCaptionIds((previous) => {
        const next = { ...previous };
        delete next[captionId];
        return next;
      });
    }
  }

  const unseenMemes = useMemo(
    () => memes.filter((meme) => !voteMap.has(meme.captionId) && !skippedCaptionIds[meme.captionId]),
    [memes, voteMap, skippedCaptionIds],
  );
  const historyMemes = useMemo(
    () =>
      memes
        .filter((meme) => voteMap.has(meme.captionId))
        .sort(
          (left, right) =>
            toTimestamp(voteTimestampMap.get(right.captionId) ?? null) -
            toTimestamp(voteTimestampMap.get(left.captionId) ?? null),
        ),
    [memes, voteMap, voteTimestampMap],
  );
  const popularMemes = useMemo(() => {
    return [...memes].sort((left, right) => {
      const leftInfo = scoreMap.get(left.captionId);
      const rightInfo = scoreMap.get(right.captionId);
      const leftUpvotes = leftInfo?.upvotes ?? 0;
      const rightUpvotes = rightInfo?.upvotes ?? 0;
      if (rightUpvotes !== leftUpvotes) return rightUpvotes - leftUpvotes;

      const leftScore = leftInfo?.score ?? 0;
      const rightScore = rightInfo?.score ?? 0;
      return rightScore - leftScore;
    });
  }, [memes, scoreMap]);
  const controversialMemes = useMemo(() => {
    return [...memes].sort((left, right) => {
      const leftInfo = scoreMap.get(left.captionId);
      const rightInfo = scoreMap.get(right.captionId);
      const leftDownvotes = leftInfo?.downvotes ?? 0;
      const rightDownvotes = rightInfo?.downvotes ?? 0;
      if (rightDownvotes !== leftDownvotes) return rightDownvotes - leftDownvotes;

      const leftScore = leftInfo?.score ?? 0;
      const rightScore = rightInfo?.score ?? 0;
      return leftScore - rightScore;
    });
  }, [memes, scoreMap]);
  const mainMeme = unseenMemes[0];

  function skipMainMeme(captionId: string) {
    setSkippedCaptionIds((previous) => ({ ...previous, [captionId]: true }));
    setClientError(null);
  }

  function renderMemeCard(meme: MemeRow, showCurrentVote: boolean, allowSkip = false) {
    const currentVote = voteMap.get(meme.captionId);
    const scoreInfo = scoreMap.get(meme.captionId);
    const isPending = Boolean(pendingCaptionIds[meme.captionId]);

    return (
      <section className="rounded-2xl border border-sky-100 bg-white p-4 shadow-sm" key={meme.captionId}>
        <Image
          alt="Meme image"
          className="mb-4 max-h-80 w-full rounded-xl border border-slate-100 object-contain"
          height={720}
          src={meme.imageUrl}
          unoptimized
          width={1280}
        />

        <p className="text-base leading-relaxed text-slate-900">{meme.captionText}</p>
        {showCurrentVote && typeof currentVote === "number" ? (
          <p className="mt-2 text-xs text-slate-500">
            Your vote: {currentVote > 0 ? "Upvote" : "Downvote"}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
              currentVote === 1
                ? "border-emerald-600 bg-emerald-100 text-emerald-800"
                : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            }`}
            disabled={isPending}
            onClick={() => mutateVote(meme.captionId, 1)}
            type="button"
          >
            {isPending && currentVote !== 1 ? "Saving..." : currentVote === 1 ? "Remove Upvote" : "Upvote"}
          </button>

          <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
            {formatScore(scoreInfo)}
          </span>

          <button
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
              currentVote === -1
                ? "border-rose-600 bg-rose-100 text-rose-800"
                : "border-rose-300 text-rose-700 hover:bg-rose-50"
            }`}
            disabled={isPending}
            onClick={() => mutateVote(meme.captionId, -1)}
            type="button"
          >
            {isPending && currentVote !== -1 ? "Saving..." : currentVote === -1 ? "Remove Downvote" : "Downvote"}
          </button>

          <span className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700">
            Up/Downvote Ratio {formatRatio(scoreInfo)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {showCurrentVote ? (
            <button
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending}
              onClick={() => mutateVote(meme.captionId, undefined)}
              type="button"
            >
              {isPending ? "Updating..." : "Unrate"}
            </button>
          ) : null}
          {allowSkip ? (
            <button
              className="rounded-lg border border-sky-200 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50"
              onClick={() => skipMainMeme(meme.captionId)}
              type="button"
            >
              Next
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-50 via-violet-50 to-white">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col md:flex-row">
        <aside className="border-b border-sky-100 bg-white px-5 py-6 md:min-h-screen md:w-72 md:border-b-0 md:border-r">
          <p className="text-xs uppercase tracking-wide text-violet-700">Caption Ratings</p>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">Meme Voting</h1>
          <p className="mt-1 text-xs text-slate-500">{userEmail}</p>

          <nav className="mt-6 space-y-2">
            {(["main", "upload", "history", "popular", "controversial"] as const).map((tab) => (
              <button
                className={`block w-full rounded-xl px-3 py-2 text-left text-sm font-medium ${
                  activeTab === tab
                    ? "bg-violet-100 text-violet-800"
                    : "bg-slate-50 text-slate-700 hover:bg-violet-50"
                }`}
                key={tab}
                onClick={() => handleTabChange(tab)}
                type="button"
              >
                {tab === "main"
                  ? "Main"
                  : tab === "upload"
                    ? "Upload Meme"
                    : tab === "history"
                      ? "View History"
                      : tab === "popular"
                        ? "Popular"
                        : "Controversial"}
              </button>
            ))}
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
          <div className="mt-4 space-y-2">
            {imageLookupError ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Could not load image rows: {imageLookupError}
              </p>
            ) : null}
            {voteError ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Could not load your vote history: {voteError}
              </p>
            ) : null}
            {actorProfileError ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Could not resolve your profile row: {actorProfileError}
              </p>
            ) : null}
            {scoreError ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Could not load score table; showing fallback where possible: {scoreError}
              </p>
            ) : null}
            {clientError ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {clientError}
              </p>
            ) : null}
          </div>

          {activeTab === "upload" ? (
            <div className="mt-5">
              <h2 className="text-lg font-semibold text-slate-900">Upload Meme</h2>
              <p className="mt-1 text-sm text-slate-600">
                Upload an image to generate captions. New uploads appear above older uploads.
              </p>
              <div className="mt-4">
                <UploadCaptionForm actorProfileId={actorProfileId} savedResults={savedUploadResults} />
              </div>
            </div>
          ) : null}

          {activeTab === "main" ? (
            <div className="mt-5">
              <h2 className="text-lg font-semibold text-slate-900">Main Feed (Unseen/Unrated)</h2>
              <p className="mt-1 text-sm text-slate-600">Upvote or downvote sends the meme to View History immediately.</p>
              <div className="mt-4">
                {mainMeme ? (
                  renderMemeCard(mainMeme, false, true)
                ) : (
                  <section className="rounded-2xl border border-sky-100 bg-white p-6 text-sm text-slate-700 shadow-sm">
                    You have rated or skipped every available meme. Use View History to change ratings or unrate.
                  </section>
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "history" ? (
            <div className="mt-5">
              <h2 className="text-lg font-semibold text-slate-900">View History</h2>
              <p className="mt-1 text-sm text-slate-600">
                Rated memes only. Re-rating or unrating updates this list immediately.
              </p>
              <div className="mt-4 space-y-4">
                {historyMemes.length > 0 ? (
                  historyMemes.map((meme) => renderMemeCard(meme, true))
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
                  popularMemes.map((meme) => renderMemeCard(meme, voteMap.has(meme.captionId)))
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
                  controversialMemes.map((meme) => renderMemeCard(meme, voteMap.has(meme.captionId)))
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
