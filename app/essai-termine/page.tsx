import Image from 'next/image'
import Link from 'next/link'

const CONTACT_URL = process.env.NEXT_PUBLIC_CONTACT_URL || '#'
const WHATSAPP_URL = process.env.NEXT_PUBLIC_WHATSAPP_URL || ''

const AVANTAGES = [
  'Interface personnalisée à votre métier',
  'Rapports illimités',
  'Export Google Drive automatique',
  'Template de rapport sur-mesure',
  'Support prioritaire',
]

export default function EssaiTerminePage() {
  return (
    <main className="min-h-screen-safe bg-background flex flex-col">
      <header className="px-6 py-4 pt-safe">
        <Image src="/logo-ionnyx.png" alt="IONNYX" width={120} height={28} />
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-12 text-center">
        {/* Success icon */}
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center mb-6">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-3 max-w-sm leading-tight">
          Vous venez de faire en 30 secondes ce qui vous prend 1 heure.
        </h1>
        <p className="text-gray-500 max-w-sm mb-8">
          Vos 2 rapports de démonstration sont prêts. Pour des rapports illimités, personnalisés à votre métier :
        </p>

        {/* Avantages */}
        <div className="w-full max-w-sm bg-white rounded-xl border border-border p-5 mb-8 text-left">
          <ul className="space-y-3">
            {AVANTAGES.map((a, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-gray-600">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
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
            Réserver un créneau avec Julien
          </a>
          {WHATSAPP_URL && (
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary w-full block text-center flex items-center justify-center gap-2"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Contacter par WhatsApp
            </a>
          )}
          <Link href="/chantiers" className="block text-center text-sm text-gray-400 hover:text-gray-600 transition-colors mt-2">
            Revoir mes rapports
          </Link>
        </div>
      </div>
    </main>
  )
}
