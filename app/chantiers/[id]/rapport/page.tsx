import { redirect } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import RapportClient from './rapport-client'
import type { RapportContenu } from '@/lib/types'

export default async function RapportPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/inscription')

  const { data: chantier } = await supabase
    .from('chantiers')
    .select('id, client_nom, user_id')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!chantier) redirect('/chantiers')

  const { data: rapport } = await supabase
    .from('rapports')
    .select('contenu_json')
    .eq('chantier_id', params.id)
    .single()

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex-shrink-0 sticky top-0 z-30 bg-white border-b border-border px-4 py-3 pt-safe flex items-center gap-3">
        <Link href="/chantiers" className="p-1 -ml-1 text-gray-400 hover:text-foreground transition-colors">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <Image src="/logo-ionnyx.png" alt="IONNYX" width={120} height={28} />
          <p className="text-xs text-gray-400 truncate">{chantier.client_nom}</p>
        </div>
      </header>

      <RapportClient
        chantierId={params.id}
        initialRapport={(rapport?.contenu_json as RapportContenu) ?? null}
      />
    </div>
  )
}
