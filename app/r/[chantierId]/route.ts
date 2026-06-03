// =============================================================
// GET /r/[chantierId] — lien court du compte rendu (lot 3B)
// =============================================================
// Redirige (302) vers le PDF du compte rendu du chantier. Sert a raccourcir le
// lien expose dans le devis Costructor : on n'y met plus l'URL Supabase longue
// mais "<NEXT_PUBLIC_SITE_URL>/r/<chantierId>". Le lien n'expose QUE l'identifiant
// du chantier (UUID), rien de sensible.
//
// Point 6 : on redirige vers la route PDF a NOM PROPRE
// (/api/export-pdf/<chantierId>/<compte-rendu-nom-date.pdf>) plutot que vers
// l'URL storage brute ("<uuid>.pdf"), pour que le fichier ouvert depuis
// Costructor porte un nom lisible. Ouverture en onglet preservee (inline).
//
// Si aucun PDF n'a encore ete persiste pour ce chantier, on renvoie un 404 propre.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { nomFichierRapport } from '@/lib/utils'
import type { RapportContenu } from '@/lib/types'

// Toujours dynamique : la cible depend de l'etat courant du rapport.
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: { chantierId: string } },
) {
  const supabase = createAdminClient()

  const { data: rapport } = await supabase
    .from('rapports')
    .select('contenu_json, pdf_url')
    .eq('chantier_id', params.chantierId)
    .maybeSingle()

  // Verrou inchange : pas de PDF persiste => 404 propre (le rapport n'est pas pret).
  const pdfPersiste = ((rapport?.pdf_url as string | null) ?? '').trim()
  if (!rapport || !pdfPersiste) {
    return new NextResponse(
      "Le compte rendu n'est pas disponible pour le moment.",
      { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    )
  }

  const { data: chantier } = await supabase
    .from('chantiers')
    .select('date_visite')
    .eq('id', params.chantierId)
    .maybeSingle()
  const dateVisiteIso =
    (chantier as { date_visite: string | null } | null)?.date_visite ?? null
  const contenu = rapport.contenu_json as RapportContenu | null
  const nom = nomFichierRapport(contenu?.client?.nom ?? '', dateVisiteIso)

  // 302 : redirection temporaire (la cible peut changer a la regeneration du PDF).
  const cible = new URL(
    `/api/export-pdf/${params.chantierId}/${encodeURIComponent(nom)}`,
    request.url,
  )
  return NextResponse.redirect(cible, 302)
}
