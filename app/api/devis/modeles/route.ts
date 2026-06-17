// =============================================================
// GET /api/devis/modeles
// =============================================================
// Liste (LECTURE SEULE) des devis-modèles exploitables du compte cible, pour le
// sélecteur de modèle de la proposition technique. Lue EN DIRECT de Costructor :
// tout ajout/renommage/suppression de modèle par Olivier est reflété aussitôt.
// Aucune écriture.

import { NextResponse } from 'next/server'
import { listerModelesCible } from '@/lib/atg-devis-modele'
import { choisirModele, type ModeleDevis } from '@/lib/atg-routing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const raw = await listerModelesCible()
    const modeles: ModeleDevis[] = raw.map((m: any) => ({
      id: m.id,
      name: m.name ?? null,
      description: m.description ?? null,
      total: m.total ?? null,
      model: !!m.model,
    }))
    // Réutilise le filtre « modèles réels » + les libellés propres de choisirModele.
    const { modelesDisponibles } = choisirModele('', modeles)
    return NextResponse.json({ modeles: modelesDisponibles })
  } catch (e) {
    // Non bloquant : si la lecture échoue, le sélecteur s'affiche juste sans options.
    console.warn('[api/devis/modeles] lecture échouée :', (e as Error).message)
    return NextResponse.json({ modeles: [] })
  }
}
