// =============================================================
// GET /r/[chantierId] — lien court du compte rendu (lot 3B)
// =============================================================
// Redirige (302) vers le PDF du compte rendu du chantier. Sert a raccourcir le
// lien expose dans le devis Costructor : on n'y met plus l'URL Supabase longue
// mais "<NEXT_PUBLIC_SITE_URL>/r/<chantierId>". Le lien n'expose QUE l'identifiant
// du chantier (UUID), rien de sensible.
//
// Si aucun PDF n'a encore ete persiste pour ce chantier, on renvoie un 404 propre
// (pas d'erreur serveur, pas de redirection cassee).

import { NextResponse } from 'next/server'
import { recupererUrlRapportPdf } from '@/lib/rapport-pdf'

// Toujours dynamique : la cible depend de l'etat courant de rapports.pdf_url.
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: { chantierId: string } },
) {
  const url = await recupererUrlRapportPdf(params.chantierId)
  if (!url) {
    return new NextResponse(
      "Le compte rendu n'est pas disponible pour le moment.",
      { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    )
  }
  // 302 : redirection temporaire (la cible peut changer a la regeneration du PDF).
  return NextResponse.redirect(url, 302)
}
