import Image from 'next/image'
import Link from 'next/link'

const CONTACT_URL = process.env.NEXT_PUBLIC_CONTACT_URL || '#'

const AVANTAGES = [
  'Interface personnalisée à votre métier',
  'Rapports illimités',
  'Export Google Drive automatique',
  'Template de rapport sur-mesure',
  'Support prioritaire',
]

export default function EssaiTerminePage() {
  return (
    <main className="min-h-screen bg-background flex flex-col">
      <header className="px-6 py-4">
        <Image src="/logo-ionnyx.png" alt="IONNYX" width={120} height={28} />
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-12 text-center">
        {/* Icon */}
        <div className="w-20 h-20 rounded-2xl bg-gray-100 flex items-center justify-center mb-6">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-3">
          Votre essai est terminé !
        </h1>
        <p className="text-gray-500 max-w-sm mb-8">
          Vous avez généré vos 2 rapports gratuits. Vous avez vu ce que l&apos;outil peut faire
          — imaginez-le personnalisé pour votre activité.
        </p>

        {/* Avantages */}
        <div className="w-full max-w-sm bg-white rounded-xl border border-border p-5 mb-8 text-left">
          <p className="text-sm font-semibold text-foreground mb-3">
            La version complète inclut :
          </p>
          <ul className="space-y-2.5">
            {AVANTAGES.map((a, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-gray-600">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {a}
              </li>
            ))}
          </ul>
        </div>

        {/* CTAs */}
        <div className="w-full max-w-sm space-y-3">
          <a
            href={CONTACT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary w-full text-lg py-4 block text-center"
          >
            Obtenir ma version personnalisée
          </a>
          <Link href="/chantiers" className="btn-tertiary w-full block text-center">
            Revoir mes rapports
          </Link>
        </div>
      </div>
    </main>
  )
}
