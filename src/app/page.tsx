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
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Supabase Auth Demo</h1>
        <p className="mt-2 text-sm text-gray-600">
          Protected route: <span className="font-medium">/term-types</span>
        </p>
        {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
        {userEmail ? (
          <p className="mt-1 text-xs text-gray-500">Signed in as {userEmail}</p>
        ) : (
          <div className="mt-4 flex justify-center">
            <GoogleAuthButton />
          </div>
        )}
        <Link
          className="mt-6 inline-flex rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
          href="/term-types"
        >
          Open Protected Route
        </Link>
      </div>
    </main>
  );
}
