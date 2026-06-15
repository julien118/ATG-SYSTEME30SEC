// =============================================================
// Aiguilleur de domaine de l'assistant (etape 0)
// =============================================================
// Appel Claude leger et isole : il ne repond PAS a la question, il la RANGE dans
// un domaine, pour que l'orchestrateur aille chercher la bonne donnee au bon
// endroit. La chaine anti-hallucination (analyse -> code calcule -> redaction)
// reste propre a chaque domaine.

import { anthropic, MODELE_CLAUDE } from '../anthropic'
import { blocHistoriquePourAiguillage, type MessageHistorique } from './historique'

export type DomaineAssistant = 'devis' | 'comptes_rendus' | 'clients' | 'recap_client' | 'inconnu'

// Domaines reellement branches. L'aiguilleur ne doit jamais classer vers un
// domaine non implemente (sinon repli sur "devis").
const DOMAINES_BRANCHES = new Set<DomaineAssistant>(['devis', 'comptes_rendus', 'clients', 'recap_client'])

function promptAiguilleur(
  question: string,
  clientContexte?: string | null,
  historique?: MessageHistorique[] | null,
): string {
  // Ligne de contexte (question de suivi) : aide a router « et son adresse ? »
  // vers le bon SUJET. L'aiguilleur ne fait que classer, il n'invente JAMAIS de
  // client ; le client du contexte est repris en CODE, pas ici.
  const ctx = (clientContexte ?? '').trim()
    ? `\nCONTEXTE DE CONVERSATION : le dernier client evoque est « ${(clientContexte ?? '').trim()} ». Une question de suivi qui ne nomme PERSONNE (ex : « et son adresse ? », « et ses devis ? », « et le compte rendu ? », « et tout sur lui ? ») porte sur CE client : classe-la selon le SUJET (adresse/telephone/email => clients ; devis/montant => devis ; compte rendu/rapport/observations => comptes_rendus ; tout/dossier complet => recap_client). Ne classe PAS ces suivis en "inconnu".\n`
    : ''
  // Transcript des derniers echanges (compréhension d'une question qui s'appuie sur
  // le passe). Vide si pas d'historique => prompt strictement inchange.
  const histo = blocHistoriquePourAiguillage(historique)
  return `Tu es l'aiguilleur d'un assistant pour Olivier, artisan en ravalement de façade et ITE. Tu ne reponds PAS a la question : tu determines de QUEL type de donnees elle releve.

QUESTION :
---
${question}
---
${ctx}${histo}

Reponds STRICTEMENT en JSON valide (aucun texte autour, pas de markdown), schema EXACT :
{ "domaine": "devis | comptes_rendus | clients | recap_client | inconnu" }

DOMAINES :
- "devis" : ses devis, montants, prix, chiffre d'affaires, typologies de travaux chiffrees. Exemples : "mon prix moyen sur les ravalements", "mes 3 plus gros devis", "le total de mes devis d'ITE", "les devis de M. Dupont", "combien j'ai devise pour tel client".
- "comptes_rendus" : ses comptes rendus de visite de chantier, ses observations terrain, les points de vigilance releves, l'etat constate d'une façade, le nombre de visites. SYNONYMES de "compte rendu" a traiter pareil : "rapport" (de visite, de chantier), "CR", "bilan de visite", "compte-rendu". Exemples : "qu'avait-on note chez M. Dupont", "quels chantiers avaient des fissures", "le compte rendu de tel chantier", "le rapport de tel chantier", "quel est le rapport de M. Dupont", "le CR de M. Dupont", "le bilan de visite de tel chantier", "combien de visites j'ai faites".
- "clients" : l'IDENTITE et les COORDONNEES de ses clients ou contacts (adresse, telephone, email, fiche), ou la liste de ses clients. Exemples : "l'adresse de M. Dupont", "le telephone de Mme Martin", "les coordonnees de tel client", "mes clients a Tours", "combien de clients j'ai".
- "recap_client" : une demande GLOBALE rassemblant TOUT ce qu'on sait sur UN client d'un coup (coordonnees + comptes rendus + devis). Exemples : "tout sur M. Dupont", "recap de M. Dupont", "fais-moi un recap de Dupont", "resume le dossier de Dupont", "tout ce que tu as sur Dupont", "fiche complete de Dupont", "le dossier de Dupont".
- "inconnu" : tout le reste (salutations, hors sujet, ou impossible a rattacher).

REGLES DE DEPARTAGE (important) :
- Un MONTANT ou des DEVIS, MEME avec un client nomme, => "devis" ("les devis de M. Dupont" => devis).
- Une OBSERVATION / un constat terrain => "comptes_rendus".
- Toute demande de la forme "le compte rendu / le rapport / le CR / le bilan (de visite) de X", "donne-moi le rapport de X", "quel est le rapport de X" => "comptes_rendus", QUEL QUE SOIT le nom X. Le nom X est TOUJOURS un chantier ou un client d'Olivier, MEME s'il ressemble a un nom celebre, religieux ou historique (ex : "Saint Thomas d'Aquin" est ici un NOM DE CHANTIER, pas le theologien ; "rapport" ne veut PAS dire ratio ou relation). Ne classe JAMAIS ces questions en "inconnu".
- L'IDENTITE ou les COORDONNEES (adresse, telephone, email, fiche, liste de clients) => "clients".
- Une demande GLOBALE sur un client (tout son dossier d'un coup : "tout sur X", "recap de X", "resume le dossier de X") => "recap_client". MAIS une demande CIBLEE sur UN seul aspect, MEME avec un client nomme, n'est PAS un recap : "l'adresse de X" => clients ; "les devis de X" => devis ; "le compte rendu de X" => comptes_rendus.
- Si la question n'a rien a voir avec ses devis, ses visites ou ses clients, reponds "inconnu".`
}

function extraireJson(texte: string): { domaine?: string } {
  const m = texte.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('Aucun JSON dans la reponse de l\'aiguilleur.')
  return JSON.parse(m[0])
}

// Classe la question dans un domaine branche. REPLI sur "devis" (chemin
// historiquement fiable) en cas d'echec/timeout de l'appel, de JSON invalide, ou
// de domaine non encore implemente : on ne degrade jamais le comportement devis
// existant a cause de ce nouvel etage.
export async function aiguiller(
  question: string,
  clientContexte?: string | null,
  historique?: MessageHistorique[] | null,
): Promise<DomaineAssistant> {
  try {
    const rep = await anthropic.messages.create({
      model: MODELE_CLAUDE,
      max_tokens: 50,
      temperature: 0,
      messages: [{ role: 'user', content: promptAiguilleur(question, clientContexte, historique) }],
    })
    const texte = rep.content[0]?.type === 'text' ? rep.content[0].text : ''
    const domaine = extraireJson(texte).domaine as DomaineAssistant | undefined
    if (domaine === 'inconnu') return 'inconnu'
    if (domaine && DOMAINES_BRANCHES.has(domaine)) return domaine
    return 'devis'
  } catch (e) {
    console.error('[assistant/aiguilleur]', e)
    return 'devis'
  }
}
