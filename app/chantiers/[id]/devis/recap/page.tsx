import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import LogoLink from '@/components/LogoLink'
import BoutonPousser from './bouton-pousser'
import BlocTotaux from './bloc-totaux'
import { ATG_USER_ID } from '@/lib/atg'
import type { Chantier, Devis, SectionDevis } from '@/lib/types'

// Force rendu dynamique sans cache (cohérent avec /devis).
export const dynamic = 'force-dynamic'
export const revalidate = 0

function formatEUR(n: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(n)
}

// Format prix unitaire compact (sans décimales si entier).
function formatUnit(n: number): string {
  return Number.isInteger(n) ? `${n} €` : formatEUR(n)
}

export default async function RecapDevisPage({
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

  // NOTE : on ne pose PLUS de statut "rapport_genere" ici (l'ancien write etait
  // mal place : l'arrivee sur le recap n'est pas la generation du compte rendu).
  // Le statut affiche est desormais DERIVE (lib/statut-affaire) de l'existence du
  // compte rendu et du statut du devis. Voir l'accueil (chantiers/page.tsx).

  const { data: devisData } = await supabase
    .from('devis')
    .select('*')
    .eq('chantier_id', params.id)
    .order('cree_le', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!devisData) redirect(`/chantiers/${params.id}/devis`)
  const devis = devisData as Devis

  const sections: SectionDevis[] =
    devis.sections_finales ?? devis.sections_proposees ?? []

  // Total global HT.
  let totalHT = 0
  for (const s of sections) {
    for (const a of s.articles) {
      if (a.quantite != null) totalHT += a.quantite * a.prix_vente
    }
  }
  totalHT = Math.round(totalHT * 100) / 100

  const dejaPouse =
    devis.statut === 'pousse_costructor' && devis.costructor_devis_url

  // Description en tête du devis (texte libre Costructor-like). Separateur tiret
  // simple entre l'objet et le client (pas de tiret cadratin).
  const descriptionDevis = `Ravalement façade - ${chantier.client_nom}${
    chantier.client_adresse ? `, ${chantier.client_adresse}` : ''
  }`

  return (
    <div className="min-h-screen-safe bg-background flex flex-col">
      <header className="sticky top-0 z-30 bg-white border-b border-border px-5 py-4 pt-safe flex items-center gap-3">
        <Link
          href={`/chantiers/${params.id}/devis`}
          className="p-1 -ml-1 text-gray-400 hover:text-foreground transition-colors"
        >
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

      <main className="flex-1 overflow-y-auto pb-32 max-w-4xl mx-auto w-full">
        {dejaPouse ? (
          <div className="mx-4 mt-4 mb-4 rounded-2xl border border-primary bg-primary/5 p-6 text-center">
            <div className="mx-auto mb-3 w-14 h-14 rounded-full bg-primary flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-base font-semibold text-foreground">
              Devis créé dans Costructor
            </p>
            <p className="text-xs text-gray-500 mt-1 mb-4">
              N° brouillon : {devis.costructor_devis_id}
            </p>
            <a
              href={devis.costructor_devis_url ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary inline-flex items-center justify-center gap-2 text-sm py-2.5 px-4"
            >
              Ouvrir dans Costructor
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </div>
        ) : null}

        {/* Bloc description en tête (style Costructor) */}
        <div className="mx-4 mt-4 mb-3 rounded-xl border border-border bg-white px-4 py-3 text-sm text-foreground">
          {descriptionDevis}
        </div>

        {/* Tableau style Costructor */}
        <div className="mx-4 rounded-xl border border-border bg-white overflow-hidden">
          {/* Header colonnes : masque sur mobile (n'a de sens qu'en mode
              colonnes), affiche a partir de sm: comme avant. */}
          <div className="hidden sm:grid sm:grid-cols-[1fr_80px_80px_110px_120px] gap-2 bg-primary text-white text-xs font-semibold uppercase tracking-wider px-3 py-2.5">
            <div>Désignation</div>
            <div className="text-right">Qté.</div>
            <div className="text-center">Unité</div>
            <div className="text-right">Prix U. HT</div>
            <div className="text-right">Total HT</div>
          </div>

          {/* Lignes */}
          {sections.map((s, sIdx) => {
            const lignes = s.articles.filter(
              (a) => a.quantite != null && a.quantite > 0,
            )
            return (
              <div key={`${s.nom}-${sIdx}`}>
                {/* Ligne section */}
                <div className="bg-gray-50 px-3 py-2 text-sm font-bold uppercase tracking-wide text-foreground border-t border-border">
                  {s.nom}
                </div>

                {/* Lignes articles */}
                {lignes.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-gray-400 italic border-t border-border">
                    Aucun métré saisi sur cette section.
                  </div>
                ) : (
                  lignes.map((a, aIdx) => {
                    const total = (a.quantite ?? 0) * a.prix_vente
                    const description = a.description_technique?.trim()
                    const hasDescription = description && description !== a.libelle
                    return (
                      <div
                        key={`${a.costructor_article_id}-${aIdx}`}
                        className="border-t border-border"
                      >
                        {/* MOBILE (< sm) : bloc empile. Libelle pleine largeur,
                            retour a la ligne normal (plus de cassure lettre par
                            lettre), puis une ligne compacte avec les chiffres. */}
                        <div className="sm:hidden px-3 pt-2.5 pb-1.5">
                          <p className="text-sm text-foreground font-medium break-words">
                            {a.libelle}
                          </p>
                          <div className="mt-1 flex items-baseline justify-between gap-2 text-xs tabular-nums">
                            <span className="text-gray-600">
                              {a.quantite} {a.unite} · {formatUnit(a.prix_vente)}
                            </span>
                            <span className="font-medium text-foreground">
                              {formatEUR(total)}
                            </span>
                          </div>
                        </div>

                        {/* DESKTOP (>= sm) : grille en colonnes, INCHANGEE. */}
                        <div className="hidden sm:grid sm:grid-cols-[1fr_80px_80px_110px_120px] gap-2 px-3 pt-2.5 pb-1.5 text-sm items-start">
                          <div className="text-foreground min-w-0 break-words font-medium">
                            {a.libelle}
                          </div>
                          <div className="text-right tabular-nums text-foreground">
                            {a.quantite}
                          </div>
                          <div className="text-center text-gray-500">
                            {a.unite}
                          </div>
                          <div className="text-right tabular-nums text-gray-700">
                            {formatUnit(a.prix_vente)}
                          </div>
                          <div className="text-right tabular-nums font-medium text-foreground">
                            {formatEUR(total)}
                          </div>
                        </div>
                        {/* Description technique (dossier d'appel d'offres) sous la ligne */}
                        {hasDescription && (
                          <div className="px-3 pb-3 text-[11px] sm:text-xs text-gray-600 leading-relaxed whitespace-pre-line">
                            {description}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )
          })}
        </div>

        {/* Totaux + taux de TVA ajustable (lot 5.2), a droite, style Costructor */}
        <div className="mx-4 mt-6 flex justify-end">
          <BlocTotaux
            devisId={devis.id}
            totalHT={totalHT}
            tvaTauxInitial={devis.tva_taux ?? 10}
          />
        </div>
      </main>

      {/* Sticky CTA push Costructor */}
      {!dejaPouse && (
        <div className="fixed bottom-0 inset-x-0 z-40 px-5 py-4 pb-safe bg-white border-t border-border">
          <div className="max-w-4xl mx-auto">
            <BoutonPousser
              devisId={devis.id}
              chantierId={params.id}
              dejaEnvoye={!!devis.costructor_devis_id}
            />
          </div>
        </div>
      )}
    </div>
  )
}
