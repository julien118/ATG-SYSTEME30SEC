// =============================================================
// Orchestrateur de l'assistant : aiguille puis delegue au domaine
// =============================================================
// Point d'entree unique appele par /api/assistant-devis. Il aiguille la question
// vers un domaine, puis delegue :
//   - "devis"          -> lib/devis-historique.ts (INCHANGE, branche tel quel).
//   - "comptes_rendus" -> lib/assistant/domaine-comptes-rendus.ts.
//   - "inconnu"         -> message propre, aucun appel de donnees, pas de plantage.
//
// Lecture seule stricte partout (Costructor en GET pour les devis, Supabase en
// SELECT pour les comptes rendus), anti-hallucination preservee par domaine.

import { repondreQuestion } from '../devis-historique'
import { aiguiller, type DomaineAssistant } from './aiguilleur'
import { repondreQuestionCr } from './domaine-comptes-rendus'

export interface ReponseOrchestrateur {
  reponse: string
  domaine: DomaineAssistant
  nb?: number // nombre d'elements pris en compte (devis ou comptes rendus)
}

const MESSAGE_INCONNU =
  'Je peux vous renseigner sur vos devis et vos comptes rendus de visite. Posez-moi une question sur l\'un de ces sujets, par exemple : « mon prix moyen sur les ravalements » ou « qu\'avait-on noté chez M. Dupont ? ».'

export async function repondreAssistant(
  question: string,
  aujourdhui: string,
): Promise<ReponseOrchestrateur> {
  const domaine = await aiguiller(question)

  if (domaine === 'comptes_rendus') {
    const { reponse, nbComptesRendus } = await repondreQuestionCr(question, aujourdhui)
    return { reponse, domaine, nb: nbComptesRendus }
  }

  if (domaine === 'inconnu') {
    return { reponse: MESSAGE_INCONNU, domaine }
  }

  // "devis" (et repli par defaut) : on delegue au moteur existant, inchange.
  const { reponse, resultat } = await repondreQuestion(question, aujourdhui)
  return { reponse, domaine: 'devis', nb: resultat.nbDevis }
}
