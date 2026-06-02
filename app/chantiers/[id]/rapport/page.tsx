import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import LogoLink from '@/components/LogoLink'
import RapportClient from './rapport-client'
import { ATG_USER_ID } from '@/lib/atg'
import type { RapportContenu } from '@/lib/types'

// Heure de visite formatee "14h30" depuis le timestamp stocke. Forcee sur le
// fuseau Europe/Paris pour rester correcte quel que soit le fuseau du serveur
// (Vercel = UTC). Renvoie null hors de la plage de travail 7h-18h30 : ainsi un
// chantier ancien sans heure reelle (date seule = minuit) n'affiche pas une
// heure parasite, et on n'ecrit jamais "à" tout seul.
function formaterHeureVisite(iso: string | null | undefined): string | null {
  if (!iso) return null
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10)
  const minutes = h * 60 + m
  if (minutes < 7 * 60 || minutes > 18 * 60 + 30) return null
  return `${h.toString().padStart(2, '0')}h${m.toString().padStart(2, '0')}`
}

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
      />
    </div>
  )
}
