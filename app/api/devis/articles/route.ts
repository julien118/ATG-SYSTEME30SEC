// =============================================================
// GET /api/devis/articles
// =============================================================
// Liste LECTURE SEULE des articles de la bibliotheque Olivier (Costructor
// /products) nettoyes pour l'autocompletion de remplacement (lot 4.3) :
// prix en euros, unite lisible, nom sans HTML, sans lignes de texte, sans
// articles sans prix/unite, dedoublonnes par nom (le plus utilise). GET only,
// aucune ecriture.

import { NextResponse } from 'next/server'
import { listerArticlesBibliotheque } from '@/lib/costructor'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const articles = await listerArticlesBibliotheque()
    return NextResponse.json({ articles })
  } catch (e) {
    console.error('[api/devis/articles]', e)
    return NextResponse.json(
      { error: 'Impossible de charger la bibliothèque d\'articles' },
      { status: 500 },
    )
  }
}
