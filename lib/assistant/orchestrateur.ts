// =============================================================
// Orchestrateur de l'assistant : aiguille puis delegue au domaine
// =============================================================
// Point d'entree unique appele par /api/assistant-devis. Il aiguille la question
// vers un domaine, puis delegue :
//   - "devis"          -> lib/devis-historique.ts (INCHANGE, branche tel quel).
//   - "comptes_rendus" -> lib/assistant/domaine-comptes-rendus.ts.
//   - "clients"         -> lib/assistant/domaine-clients.ts.
//   - "inconnu"         -> message propre, aucun appel de donnees, pas de plantage.
//
// Lecture seule stricte partout (Costructor en GET pour devis et clients,
// Supabase en SELECT pour les comptes rendus), anti-hallucination par domaine.

import { repondreQuestion } from '../devis-historique'
import { aiguiller, type DomaineAssistant } from './aiguilleur'
import { repondreQuestionCr } from './domaine-comptes-rendus'
import { repondreQuestionClients } from './domaine-clients'
import { repondreRecapClient } from './domaine-recap'

export interface ReponseOrchestrateur {
  reponse: string
  domaine: DomaineAssistant
  nb?: number // nombre d'elements pris en compte (devis ou comptes rendus)
  // Dernier client traite, a renvoyer au frontend pour le CONTEXTE de conversation
  // (questions de suivi « et son adresse ? »). null quand la question n'a pas porte
  // sur un client precis (le frontend conserve alors son contexte courant).
  clientContexte?: string | null
}

// Contexte de conversation transmis par le frontend (lecture seule, sans session
// serveur) : le dernier client evoque, pour resoudre les questions de suivi.
export interface ContexteConversation {
  dernierClient?: string | null
}

const MESSAGE_INCONNU =
  'Je peux vous renseigner sur vos devis, vos comptes rendus de visite et vos clients. Posez-moi une question sur l\'un de ces sujets, par exemple : « mon prix moyen sur les ravalements », « qu\'avait-on noté chez M. Dupont ? » ou « l\'adresse de M. Dupont ».'

export async function repondreAssistant(
  question: string,
  aujourdhui: string,
  contexte?: ContexteConversation,
): Promise<ReponseOrchestrateur> {
  const clientContexte = contexte?.dernierClient ?? null
  // L'aiguilleur recoit le contexte (indice de routage des suivis) ; il ne fait
  // que classer le sujet, il n'invente jamais de client.
  const domaine = await aiguiller(question, clientContexte)

  if (domaine === 'comptes_rendus') {
    const { reponse, nbComptesRendus, clientResolu } = await repondreQuestionCr(
      question, aujourdhui, undefined, clientContexte,
    )
    return { reponse, domaine, nb: nbComptesRendus, clientContexte: clientResolu }
  }

  if (domaine === 'clients') {
    const { reponse, nbContacts, clientResolu } = await repondreQuestionClients(
      question, undefined, clientContexte,
    )
    return { reponse, domaine, nb: nbContacts, clientContexte: clientResolu }
  }

  if (domaine === 'recap_client') {
    const { reponse, nb, clientResolu } = await repondreRecapClient(question, clientContexte)
    return { reponse, domaine, nb, clientContexte: clientResolu }
  }

  if (domaine === 'inconnu') {
    // On preserve le contexte courant (on ne le change pas sur une question hors sujet).
    return { reponse: MESSAGE_INCONNU, domaine, clientContexte }
  }

  // "devis" (et repli par defaut) : on delegue au moteur existant.
  const { reponse, resultat, clientResolu } = await repondreQuestion(
    question, aujourdhui, undefined, clientContexte,
  )
  return { reponse, domaine: 'devis', nb: resultat.nbDevis, clientContexte: clientResolu }
}
