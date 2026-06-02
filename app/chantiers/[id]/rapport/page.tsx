import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import LogoLink from '@/components/LogoLink'
import RapportClient from './rapport-client'
import { ATG_USER_ID } from '@/lib/atg'
import { formaterHeureVisite } from '@/lib/utils'
import type { RapportContenu } from '@/lib/types'

export default async function RapportPage({ params }: { params: { id: string } }) {
  const supabase = createClient()

  const { data: chantier } = await supabase
    .from('chantiers')
    .select('id, client_nom, user_id, date_visite')
    .eq('id', params.id)
    .eq('user_id', ATG_USER_ID)
    .single()

  if (!chantier) redirect('/chantiers')

  const heureVisite = formaterHeureVisite((chantier as { date_visite: string | null }).date_visite)

  const { data: rapport } = await supabase
    .from('rapports')
    .select('contenu_json')
    .eq('chantier_id', params.id)
    .single()

  return (
    <div className="min-h-screen-safe bg-background flex flex-col">
      <header className="flex-shrink-0 sticky top-0 z-30 bg-white border-b border-border px-5 py-4 pt-safe flex items-center gap-3">
        <Link href="/chantiers" className="p-1 -ml-1 text-gray-400 hover:text-foreground transition-colors">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <LogoLink width={120} height={28} />
          <p className="text-xs text-gray-400 truncate">{chantier.client_nom}</p>
        </div>
      </header>

      <RapportClient
        chantierId={params.id}
        initialRapport={(rapport?.contenu_json as RapportContenu) ?? null}
        heureVisite={heureVisite}
        dateVisiteIso={(chantier as { date_visite: string | null }).date_visite}
      />
    </div>
  )
}
