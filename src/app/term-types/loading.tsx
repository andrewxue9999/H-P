export default function Loading() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-50 via-violet-50 to-white">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-6">
        <section className="w-full max-w-md rounded-3xl border border-sky-100 bg-white/90 p-6 text-center shadow-sm">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
          <h1 className="mt-4 text-lg font-semibold text-slate-900">Loading captions</h1>
          <p className="mt-2 text-sm text-slate-600">Fetching your feed, votes, and rankings.</p>
        </section>
      </div>
    </main>
  );
}
