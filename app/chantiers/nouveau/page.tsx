import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import LogoLink from '@/components/LogoLink'
import ChantierForm from '@/components/ChantierForm'

export default async function NouveauChantierPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/inscription')

  return (
    <div className="min-h-screen-safe bg-background">
      <header className="sticky top-0 z-30 bg-white border-b border-border px-5 py-4 pt-safe flex items-center gap-3">
        <Link href="/chantiers" className="p-1 -ml-1 text-gray-400 hover:text-foreground transition-colors">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <LogoLink width={120} height={28} />
        <div className="flex-1" />
        <a href="https://ionnyx.fr/" className="text-sm font-medium border border-primary text-primary rounded-lg px-4 py-2 hover:bg-primary hover:text-white transition-colors whitespace-nowrap">
          Voir le site IONNYX →
        </a>
      </header>

      <main className="px-5 py-6 max-w-lg mx-auto page-enter">
        <h1 className="text-xl font-bold text-foreground mb-1">Nouvelle visite</h1>
        <p className="text-gray-400 text-sm mb-6">Renseignez les informations du chantier.</p>
        <ChantierForm userId={user.id} />
      </main>
    </div>
  )
}
