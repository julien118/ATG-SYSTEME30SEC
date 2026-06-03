// =============================================================
// Orchestrateur de l'assistant : aiguille puis delegue au domaine
// =============================================================
// Point d'entree unique appele par /api/assistant-devis. Il aiguille la question
// vers un domaine, puis delegue :
//   - "devis"   -> lib/devis-historique.ts (INCHANGE, branche tel quel).
//   - "inconnu" -> message propre, aucun appel de donnees, pas de plantage.
//
// Lecture seule stricte (Costructor en GET pour les devis), anti-hallucination
// preservee par domaine.

import { repondreQuestion } from '../devis-historique'
import { aiguiller, type DomaineAssistant } from './aiguilleur'

export interface ReponseOrchestrateur {
  reponse: string
  domaine: DomaineAssistant
  nb?: number // nombre d'elements pris en compte
}

const MESSAGE_INCONNU =
  'Je peux vous renseigner sur vos devis. Posez-moi une question sur ce sujet, par exemple : « mon prix moyen sur les ravalements » ou « mes 3 plus gros devis ».'

export async function repondreAssistant(
  question: string,
  aujourdhui: string,
): Promise<ReponseOrchestrateur> {
  const domaine = await aiguiller(question)

  if (domaine === 'inconnu') {
    return { reponse: MESSAGE_INCONNU, domaine }
  }

  // "devis" (et repli par defaut) : on delegue au moteur existant, inchange.
  const { reponse, resultat } = await repondreQuestion(question, aujourdhui)
  return { reponse, domaine: 'devis', nb: resultat.nbDevis }
}
