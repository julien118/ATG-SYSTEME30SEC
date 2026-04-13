'use client'

const CONTACT_URL = process.env.NEXT_PUBLIC_CONTACT_URL || '#'

export default function TrialBanner({ rapportsGeneres }: { rapportsGeneres: number }) {
  const remaining = Math.max(0, 2 - rapportsGeneres)
  const progress = (rapportsGeneres / 2) * 100
  const isFinished = rapportsGeneres >= 2

  if (isFinished) {
    return (
      <div className="rounded-2xl bg-gradient-to-b from-emerald-50 to-white border border-primary/10 p-6">
        <h2 className="text-lg font-bold text-foreground mb-1">
          Vous avez gagné du temps, non ?
        </h2>
        <p className="text-sm text-gray-500 mb-5">
          Imaginez ça lors de chacune de vos visites, personnalisée pour vous !
        </p>
        <a
          href={CONTACT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary w-full text-base py-3.5 block text-center"
        >
          Échanger avec Julien — 20 min
        </a>
        <p className="text-xs text-gray-400 text-center mt-3">
          Gratuit, sans engagement. On regarde ensemble comment l&apos;adapter à votre activité.
        </p>
      </div>
    )
  }

  return (
    <div role="status" aria-label={`${remaining} rapports restants sur 2`} className="rounded-xl p-4 bg-input-focus border border-primary/10">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-foreground">
          Essai gratuit — {remaining} rapport{remaining > 1 ? 's' : ''} restant{remaining > 1 ? 's' : ''} sur 2
        </span>
      </div>
      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-primary to-primary-dark"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
