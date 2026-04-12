export default function ChantiersLoading() {
  return (
    <div className="min-h-screen-safe bg-background">
      <header className="sticky top-0 z-30 bg-white border-b border-border px-4 py-3 pt-safe flex items-center justify-between">
        <div className="skeleton h-7 w-28" />
        <div className="skeleton h-9 w-9 rounded-full" />
      </header>
      <main className="px-4 py-4 max-w-2xl mx-auto">
        <div className="skeleton h-16 w-full rounded-xl mb-4" />
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1">
          <div className="skeleton flex-1 h-9 rounded-lg" />
          <div className="skeleton flex-1 h-9 rounded-lg" />
          <div className="skeleton flex-1 h-9 rounded-lg" />
        </div>
        <div className="skeleton h-12 w-full rounded-xl mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-border p-4 space-y-2">
              <div className="flex justify-between">
                <div className="skeleton h-5 w-40" />
                <div className="skeleton h-6 w-20 rounded-full" />
              </div>
              <div className="skeleton h-4 w-56" />
              <div className="skeleton h-4 w-32" />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
