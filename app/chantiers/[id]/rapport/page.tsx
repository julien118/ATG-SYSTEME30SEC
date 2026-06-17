import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
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

  // Etape C : un devis existe-t-il deja pour ce chantier ? Si oui, le bouton du CR
  // devient "Continuer mon devis" (navigation simple, sans regenerer). Le client
  // anon NE LIT PAS la table devis : on utilise l'admin UNIQUEMENT pour ce SELECT
  // en lecture (le reste de la page reste en anon). Aucune ecriture.
  const admin = createAdminClient()
  const { data: devisExistant } = await admin
    .from('devis')
    .select('id')
    .eq('chantier_id', params.id)
    .maybeSingle()
  const aDevis = !!devisExistant

  return (
    // App-shell mobile : hauteur DEFINIE (h-full) + colonne flex => seul le contenu
    // interne defile (footer epingle en flux). Meme patron que visite/devis/recap.
    <div className="h-full bg-background flex flex-col">
      <header className="flex-shrink-0 sticky top-0 z-30 bg-header border-b border-white/10 px-5 py-4 pt-safe flex items-center gap-3">
        <Link href="/chantiers" className="flex h-10 w-10 -ml-2 items-center justify-center rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition-colors">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <LogoLink width={120} height={28} />
          <p className="text-xs text-gray-300 truncate">{chantier.client_nom}</p>
        </div>
      </header>

      <RapportClient
        chantierId={params.id}
        initialRapport={(rapport?.contenu_json as RapportContenu) ?? null}
        heureVisite={heureVisite}
        dateVisiteIso={(chantier as { date_visite: string | null }).date_visite}
        aDevis={aDevis}
      />
    </div>
  )
}
