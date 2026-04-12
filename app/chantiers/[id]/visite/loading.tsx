export default function VisiteLoading() {
  return (
    <div className="h-screen-safe flex flex-col bg-background">
      <header className="flex-shrink-0 bg-white border-b border-border px-5 py-4 pt-safe">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <div className="skeleton h-5 w-36 mb-1" />
            <div className="skeleton h-3 w-24" />
          </div>
          <div className="skeleton h-9 w-24 rounded-xl" />
        </div>
      </header>
      <div className="flex-1 flex items-center justify-center text-gray-300">
        <p className="text-sm">Chargement...</p>
      </div>
      <div className="flex-shrink-0 bg-white border-t border-border px-5 py-4 pb-safe">
        <div className="max-w-lg mx-auto flex gap-3">
          <div className="skeleton flex-1 h-14 rounded-xl" />
          <div className="skeleton flex-1 h-14 rounded-xl" />
        </div>
      </div>
    </div>
  )
}
