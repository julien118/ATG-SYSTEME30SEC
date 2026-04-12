'use client'

import Link from 'next/link'

export default function TrialBanner({ rapportsGeneres }: { rapportsGeneres: number }) {
  const remaining = Math.max(0, 2 - rapportsGeneres)
  const progress = (rapportsGeneres / 2) * 100
  const isFinished = rapportsGeneres >= 2

  return (
    <div role="status" aria-label={`${remaining} rapports restants sur 2`} className={`rounded-xl p-4 ${isFinished ? 'bg-gray-100' : 'bg-input-focus border border-primary/10'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-foreground">
          {isFinished
            ? 'Essai terminé'
            : `Essai gratuit — ${remaining} rapport${remaining > 1 ? 's' : ''} restant${remaining > 1 ? 's' : ''} sur 2`
          }
        </span>
        {isFinished && (
          <Link href="/essai-termine" className="text-sm font-medium text-primary hover:underline">
            En savoir plus
          </Link>
        )}
      </div>
      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isFinished ? 'bg-gray-400' : 'bg-gradient-to-r from-primary to-primary-dark'}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
