import GoogleAuthButton from "@/components/google-auth-button";
import SignOutButton from "@/components/sign-out-button";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigError } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

type TermType = {
  id: number;
  name: string;
  created_datetime_utc: string;
};

export default async function TermTypesPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <main className="min-h-screen p-8">
        <h1 className="text-2xl font-semibold">Term Types</h1>
        <p className="mt-4 text-sm text-red-600">{supabaseConfigError}</p>
      </main>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <section className="w-full max-w-lg rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Protected Route</p>
          <h1 className="mt-2 text-2xl font-semibold text-gray-900">Term Types</h1>
          <p className="mt-3 text-sm text-gray-600">
            You must sign in to view this page.
          </p>
          <div className="mt-6 flex items-center justify-center">
            <GoogleAuthButton />
          </div>
        </section>
      </main>
    );
  }

  const { data, error } = await supabase
    .from("term_types")
    .select("id, name, created_datetime_utc")
    .order("id", { ascending: true });

  if (error) {
    return (
      <main className="min-h-screen p-8">
        <h1 className="text-2xl font-semibold">Term Types</h1>
        <p className="mt-4 text-sm text-red-600">{error.message}</p>
      </main>
    );
  }

  const rows = (data ?? []) as TermType[];

  return (
    <main className="min-h-screen p-8">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Term Types</h1>
          <p className="mt-1 text-xs text-gray-500">Signed in as {user.email}</p>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-xs text-gray-500">{rows.length} rows</p>
          <SignOutButton />
        </div>
      </div>
      <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Created (UTC)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rows.map((row) => (
              <tr key={row.id} className="bg-white">
                <td className="px-4 py-3 text-gray-900">{row.id}</td>
                <td className="px-4 py-3 text-gray-900">{row.name}</td>
                <td className="px-4 py-3 text-gray-600">
                  {new Date(row.created_datetime_utc).toISOString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
