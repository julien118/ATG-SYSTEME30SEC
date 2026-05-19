import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import LogoLink from '@/components/LogoLink'
import ChantierForm from '@/components/ChantierForm'
import { ATG_USER_ID } from '@/lib/atg'
import type { Chantier } from '@/lib/types'

export default async function ChantierDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()

  const { data: chantier } = await supabase
    .from('chantiers')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', ATG_USER_ID)
    .single()

  if (!chantier) redirect('/chantiers')

  // If rapport already exists, go to rapport page
  if ((chantier as Chantier).statut === 'rapport_genere') {
    redirect(`/chantiers/${params.id}/rapport`)
  }

  // If en_cours, go to visite
  if ((chantier as Chantier).statut === 'en_cours') {
    redirect(`/chantiers/${params.id}/visite`)
  }

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

      <main className="px-5 py-6 max-w-lg mx-auto">
        <h1 className="text-xl font-bold text-foreground mb-1">Modifier le chantier</h1>
        <p className="text-gray-400 text-sm mb-6">{(chantier as Chantier).client_nom}</p>
        <ChantierForm chantier={chantier as Chantier} userId={ATG_USER_ID} />
      </main>
    </div>
  )
}
