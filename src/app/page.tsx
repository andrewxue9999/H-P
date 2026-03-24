import Link from "next/link";
import GoogleAuthButton from "@/components/google-auth-button";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigError } from "@/lib/supabase/env";

export default async function Home() {
  let userEmail: string | null = null;
  let error: string | null = null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userEmail = user?.email ?? null;
  } catch {
    error = supabaseConfigError;
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#dbeafe,transparent_40%),linear-gradient(180deg,#f8fbff_0%,#eef6ff_100%)]">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-12">
        <div className="grid w-full gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[2rem] border border-sky-100 bg-white/85 p-8 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur md:p-12">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-700">Caption Ratings</p>
            <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight text-slate-950 md:text-6xl">
              Upload memes, generate captions, and vote through a protected Supabase app.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 md:text-lg">
              The app supports Google login, protected voting, persistent uploads, vote history, and ranked meme feeds.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                className="inline-flex items-center rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                href="/term-types"
              >
                Open App
              </Link>
              {!userEmail ? (
                <GoogleAuthButton />
              ) : (
                <p className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-5 py-3 text-sm text-slate-600">
                  Signed in as {userEmail}
                </p>
              )}
            </div>

            {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4">
                <p className="text-sm font-semibold text-slate-900">Protected Voting</p>
                <p className="mt-2 text-sm text-slate-600">Authenticated users can upvote, downvote, switch votes, and unrate instantly.</p>
              </div>
              <div className="rounded-2xl border border-violet-100 bg-violet-50/80 p-4">
                <p className="text-sm font-semibold text-slate-900">Persistent Uploads</p>
                <p className="mt-2 text-sm text-slate-600">Uploaded memes and generated captions stay available after refresh and sign-in cycles.</p>
              </div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
                <p className="text-sm font-semibold text-slate-900">Supabase Backed</p>
                <p className="mt-2 text-sm text-slate-600">Authentication, reads, and mutations all run through Supabase instead of mock data.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-[2rem] border border-slate-200 bg-slate-950 p-8 text-white shadow-[0_30px_80px_rgba(15,23,42,0.18)] md:p-10">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-300">Workflow</p>
              <ol className="mt-6 space-y-5 text-sm text-slate-300">
                <li>
                  <span className="font-semibold text-white">1. Sign in</span>
                  <p className="mt-1">Google OAuth protects the voting and upload workflow.</p>
                </li>
                <li>
                  <span className="font-semibold text-white">2. Upload</span>
                  <p className="mt-1">Submit an image, generate captions, and verify the result is persisted.</p>
                </li>
                <li>
                  <span className="font-semibold text-white">3. Vote</span>
                  <p className="mt-1">Use the Main, History, Popular, and Controversial views to evaluate captions.</p>
                </li>
              </ol>
            </div>

            <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Route</p>
              <p className="mt-2 text-lg font-semibold text-white">/term-types</p>
              <p className="mt-2 text-sm text-slate-300">
                Protected application surface for uploading, voting, reviewing history, and browsing ranked meme feeds.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
