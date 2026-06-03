// =============================================================
// Aiguilleur de domaine de l'assistant (etape 0)
// =============================================================
// Appel Claude leger et isole : il ne repond PAS a la question, il la RANGE dans
// un domaine, pour que l'orchestrateur aille chercher la bonne donnee au bon
// endroit. La chaine anti-hallucination (analyse -> code calcule -> redaction)
// reste propre a chaque domaine.

import { anthropic } from '../anthropic'

const MODELE_CLAUDE = 'claude-sonnet-4-20250514'

export type DomaineAssistant = 'devis' | 'comptes_rendus' | 'inconnu'

// Domaines reellement branches a cette etape (A+B). "clients" rejoindra ce
// registre a l'etape C, quand son module existera : l'aiguilleur ne doit jamais
// classer vers un domaine non encore implemente (sinon repli sur "devis").
const DOMAINES_BRANCHES = new Set<DomaineAssistant>(['devis', 'comptes_rendus'])

function promptAiguilleur(question: string): string {
  return `Tu es l'aiguilleur d'un assistant pour Olivier, artisan en ravalement de façade et ITE. Tu ne reponds PAS a la question : tu determines de QUEL type de donnees elle releve.

QUESTION :
---
${question}
---

Reponds STRICTEMENT en JSON valide (aucun texte autour, pas de markdown), schema EXACT :
{ "domaine": "devis | comptes_rendus | inconnu" }

DOMAINES :
- "devis" : ses devis, montants, prix, chiffre d'affaires, typologies de travaux chiffrees. Exemples : "mon prix moyen sur les ravalements", "mes 3 plus gros devis", "le total de mes devis d'ITE", "combien j'ai devise pour tel client".
- "comptes_rendus" : ses comptes rendus de visite de chantier, ses observations terrain, les points de vigilance releves, l'etat constate d'une façade, le nombre de visites. Exemples : "qu'avait-on note chez M. Dupont", "quels chantiers avaient des fissures", "le compte rendu de tel chantier", "combien de visites j'ai faites".
- "inconnu" : tout le reste (salutations, hors sujet, ou impossible a rattacher a l'un des deux).

REGLE : en cas de doute entre devis et comptes_rendus, tranche sur le coeur de la question (un chiffre/montant => devis ; une observation/un constat terrain => comptes_rendus). Si la question n'a rien a voir avec ses devis ou ses visites, reponds "inconnu".`
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
export async function aiguiller(question: string): Promise<DomaineAssistant> {
  try {
    const rep = await anthropic.messages.create({
      model: MODELE_CLAUDE,
      max_tokens: 50,
      temperature: 0,
      messages: [{ role: 'user', content: promptAiguilleur(question) }],
    })
    const texte = rep.content[0]?.type === 'text' ? rep.content[0].text : ''
    const domaine = extraireJson(texte).domaine as DomaineAssistant | undefined
    if (domaine === 'inconnu') return 'inconnu'
    if (domaine && DOMAINES_BRANCHES.has(domaine)) return domaine
    return 'devis'
  } catch {
    return 'devis'
  }
}
