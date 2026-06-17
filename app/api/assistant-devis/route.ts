// =============================================================
// POST /api/assistant-devis
// =============================================================
// Assistant de consultation (LECTURE SEULE). Body : { question }. Passe par
// l'orchestrateur (lib/assistant/orchestrateur.ts) qui aiguille la question vers
// le bon domaine (devis, comptes rendus, ou inconnu) puis delegue. Le domaine
// "devis" reste branche sur lib/devis-historique.ts inchange. Aucune ecriture.

import { NextResponse } from 'next/server'
import { repondreAssistant } from '@/lib/assistant/orchestrateur'
import { reportError } from '@/lib/monitoring'
import type { DomaineAssistant } from '@/lib/assistant/aiguilleur'
import { nettoyerHistorique } from '@/lib/assistant/historique'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const { question, dernierClient, clientForce, domaineForce, historique } = (await request
      .json()
      .catch(() => ({}))) as {
      question?: string
      // Contexte de conversation (amelioration 3) : dernier client evoque, renvoye
      // par le frontend pour resoudre les questions de suivi (« et son adresse ? »).
      dernierClient?: string | null
      // Clic sur un candidat (amelioration 4) : nom canonique exact a forcer +
      // domaine d'origine, pour resoudre une seule fiche sans ré-ambiguïté.
      clientForce?: string | null
      domaineForce?: string | null
      // Memoire de la conversation en cours : les derniers echanges, pour resoudre
      // une question qui s'appuie sur le passe. Sert UNIQUEMENT a la comprehension.
      historique?: unknown
    }
    if (!question || typeof question !== 'string' || !question.trim()) {
      return NextResponse.json({ error: 'Question manquante' }, { status: 400 })
    }

    // Date du jour cote serveur, pour interpreter les periodes relatives
    // ("ce mois-ci", "en mai"...) dans l'analyse de la question.
    const aujourdhui = new Date().toISOString().slice(0, 10)
    const { reponse, domaine, nb, clientContexte, candidats } = await repondreAssistant(
      question.trim(),
      aujourdhui,
      {
        dernierClient: typeof dernierClient === 'string' ? dernierClient : null,
        clientForce: typeof clientForce === 'string' ? clientForce : null,
        domaineForce: typeof domaineForce === 'string' ? (domaineForce as DomaineAssistant) : null,
        historique: nettoyerHistorique(historique),
      },
    )

    // `clientContexte` : a stocker cote frontend pour la prochaine question de suivi.
    // `candidats` : boutons cliquables quand un nom est ambigu (amelioration 4).
    return NextResponse.json({ reponse, domaine, nb, clientContexte, candidats })
  } catch (e) {
    console.error('[api/assistant-devis]', e)
    await reportError('Assistant', e)
    return NextResponse.json(
      { error: 'Désolé, une erreur est survenue. Réessayez dans un instant.' },
      { status: 500 },
    )
  }
}
