export default function RapportLoading() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex-shrink-0 sticky top-0 z-30 bg-white border-b border-border px-4 py-3 pt-safe flex items-center gap-3">
        <div className="skeleton h-6 w-6 rounded" />
        <div>
          <div className="skeleton h-6 w-24 mb-1" />
          <div className="skeleton h-3 w-32" />
        </div>
      </header>
      <div className="flex-1 px-4 py-4 max-w-2xl mx-auto w-full space-y-4">
        <div className="bg-white rounded-xl border border-border p-4 space-y-2">
          <div className="skeleton h-4 w-28 mb-3" />
          <div className="skeleton h-4 w-48" />
          <div className="skeleton h-4 w-56" />
          <div className="skeleton h-4 w-36" />
        </div>
        {[1, 2].map((i) => (
          <div key={i} className="bg-white rounded-xl border border-border overflow-hidden">
            <div className="p-4 space-y-2">
              <div className="skeleton h-5 w-44" />
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-3/4" />
            </div>
            <div className="px-4 pb-3">
              <div className="skeleton h-40 w-full rounded-lg" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex-shrink-0 bg-white border-t border-border px-4 py-3 pb-safe">
        <div className="flex gap-2">
          <div className="skeleton flex-1 h-11 rounded-xl" />
          <div className="skeleton flex-1 h-11 rounded-xl" />
        </div>
      </div>
    </div>
  )
}
