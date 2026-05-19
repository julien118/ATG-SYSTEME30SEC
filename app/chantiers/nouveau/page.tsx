import Link from 'next/link'
import LogoLink from '@/components/LogoLink'
import ChantierForm from '@/components/ChantierForm'
import { ATG_USER_ID } from '@/lib/atg'

// Mode démo ATG : pas d'auth, user_id en dur passé au formulaire.
export default function NouveauChantierPage() {
  return (
    <div className="min-h-screen-safe bg-background">
      <header className="sticky top-0 z-30 bg-white border-b border-border px-5 py-4 pt-safe flex items-center gap-3">
        <Link href="/chantiers" className="p-1 -ml-1 text-gray-400 hover:text-foreground transition-colors">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <LogoLink width={120} height={28} />
      </header>

      <main className="px-5 py-6 max-w-lg mx-auto page-enter">
        <h1 className="text-xl font-bold text-foreground mb-1">Nouvelle visite</h1>
        <p className="text-gray-400 text-sm mb-6">Renseignez les informations du chantier.</p>
        <ChantierForm userId={ATG_USER_ID} />
      </main>
    </div>
  )
}
