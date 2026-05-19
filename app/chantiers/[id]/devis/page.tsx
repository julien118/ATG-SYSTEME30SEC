import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import LogoLink from '@/components/LogoLink'
import DevisEditeur from './devis-editeur'
import { ATG_USER_ID } from '@/lib/atg'
import type { Chantier, Devis, SectionDevis } from '@/lib/types'

// Force rendu dynamique sans cache : à chaque visite on relit la DB.
// Évite d'afficher un vieux devis quand l'utilisateur vient de cliquer
// "Préparer mon devis" (qui régénère le row côté serveur).
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Page Devis Express : sections proposées + saisie vocale des métrés + total live.
// Server Component qui charge le dernier devis du chantier et passe au composant client.
// Utilise admin client pour bypass RLS (mode démo single-tenant).
export default async function DevisPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createAdminClient()

  const { data: chantierData } = await supabase
    .from('chantiers')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', ATG_USER_ID)
    .single()
  if (!chantierData) redirect('/chantiers')
  const chantier = chantierData as Chantier

  const { data: devisData } = await supabase
    .from('devis')
    .select('*')
    .eq('chantier_id', params.id)
    .order('cree_le', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!devisData) {
    return (
      <div className="min-h-screen-safe bg-background flex flex-col">
        <header className="sticky top-0 z-30 bg-white border-b border-border px-5 py-4 pt-safe flex items-center gap-3">
          <Link href={`/chantiers/${params.id}/rapport`} className="p-1 -ml-1 text-gray-400 hover:text-foreground transition-colors">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <LogoLink width={120} height={28} />
        </header>
        <main className="flex-1 px-5 py-10 max-w-md mx-auto text-center">
          <p className="text-sm text-gray-500 mb-4">
            Pas encore de proposition de devis pour ce chantier.
          </p>
          <Link
            href={`/chantiers/${params.id}/rapport`}
            className="text-primary underline text-sm"
          >
            Retourner au compte rendu et cliquer &quot;Préparer mon devis&quot;
          </Link>
        </main>
      </div>
    )
  }

  const devis = devisData as Devis
  const sections: SectionDevis[] =
    devis.sections_finales ?? devis.sections_proposees ?? []

  return (
    <div className="min-h-screen-safe bg-background flex flex-col">
      <header className="flex-shrink-0 sticky top-0 z-30 bg-white border-b border-border px-5 py-4 pt-safe flex items-center gap-3">
        <Link href={`/chantiers/${params.id}/rapport`} className="p-1 -ml-1 text-gray-400 hover:text-foreground transition-colors">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <LogoLink width={120} height={28} />
          <p className="text-xs text-gray-400 truncate">
            Devis - {chantier.client_nom}
          </p>
        </div>
      </header>

      <DevisEditeur
        chantierId={params.id}
        devisId={devis.id}
        sectionsInitiales={sections}
      />
    </div>
  )
}
