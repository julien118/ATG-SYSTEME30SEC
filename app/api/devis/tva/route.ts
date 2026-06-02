// =============================================================
// POST /api/devis/tva
// =============================================================
// Body : { devisId, tva_taux }
// Persiste le taux de TVA choisi par le pro sur l'ecran recap (lot 5.2), en
// points de pourcentage (0 a 100). C'est ce taux que /api/devis/pousser relit
// pour poser le taxRate sur les lignes Costructor et calculer le total TTC.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  try {
    const { devisId, tva_taux } = (await request.json().catch(() => ({}))) as {
      devisId?: string
      tva_taux?: number
    }
    if (!devisId) {
      return NextResponse.json({ error: 'devisId manquant' }, { status: 400 })
    }
    const taux = Number(tva_taux)
    if (!Number.isFinite(taux) || taux < 0 || taux > 100) {
      return NextResponse.json(
        { error: 'tva_taux invalide (attendu entre 0 et 100)' },
        { status: 400 },
      )
    }
    // Arrondi au dixieme, coherent avec la borne cote interface.
    const tauxNorm = Math.round(taux * 10) / 10

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('devis')
      .update({ tva_taux: tauxNorm })
      .eq('id', devisId)
    if (error) throw error

    return NextResponse.json({ ok: true, tva_taux: tauxNorm })
  } catch (e) {
    console.error('[api/devis/tva]', e)
    return NextResponse.json(
      { ok: false, error: (e as Error).message ?? 'Erreur enregistrement TVA' },
      { status: 500 },
    )
  }
}
