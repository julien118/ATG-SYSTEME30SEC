// =============================================================
// POST /api/assistant-devis
// =============================================================
// Assistant de consultation de l'historique des devis (LECTURE SEULE).
// Body : { question }. Appelle le moteur lib/devis-historique.ts (deja valide)
// SANS modifier sa logique, et renvoie la reponse redigee a partir des vraies
// donnees. Aucune ecriture nulle part.

import { NextResponse } from 'next/server'
import { repondreQuestion } from '@/lib/devis-historique'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const { question } = (await request.json().catch(() => ({}))) as {
      question?: string
    }
    if (!question || typeof question !== 'string' || !question.trim()) {
      return NextResponse.json({ error: 'Question manquante' }, { status: 400 })
    }

    // Date du jour cote serveur, pour interpreter les periodes relatives
    // ("ce mois-ci", "en mai"...) dans l'analyse de la question.
    const aujourdhui = new Date().toISOString().slice(0, 10)
    const { reponse, resultat } = await repondreQuestion(question.trim(), aujourdhui)

    return NextResponse.json({ reponse, nbDevis: resultat.nbDevis })
  } catch (e) {
    console.error('[api/assistant-devis]', e)
    return NextResponse.json(
      { error: 'Désolé, une erreur est survenue. Réessayez dans un instant.' },
      { status: 500 },
    )
  }
}
