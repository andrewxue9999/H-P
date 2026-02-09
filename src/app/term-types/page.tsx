import { supabase, supabaseConfigError } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";

type TermType = {
  id: number;
  name: string;
  created_datetime_utc: string;
};

export default async function TermTypesPage() {
  if (!supabase) {
    return (
      <main className="min-h-screen p-8">
        <h1 className="text-2xl font-semibold">Term Types</h1>
        <p className="mt-4 text-sm text-red-600">{supabaseConfigError}</p>
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
        <h1 className="text-2xl font-semibold">Term Types</h1>
        <p className="text-xs text-gray-500">{rows.length} rows</p>
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
