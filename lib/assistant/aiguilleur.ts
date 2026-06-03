// =============================================================
// Aiguilleur de domaine de l'assistant (etape 0)
// =============================================================
// Appel Claude leger et isole : il ne repond PAS a la question, il la RANGE dans
// un domaine, pour que l'orchestrateur aille chercher la bonne donnee au bon
// endroit. La chaine anti-hallucination (analyse -> code calcule -> redaction)
// reste propre a chaque domaine.

import { anthropic } from '../anthropic'

const MODELE_CLAUDE = 'claude-sonnet-4-20250514'

export type DomaineAssistant = 'devis' | 'inconnu'

function promptAiguilleur(question: string): string {
  return `Tu es l'aiguilleur d'un assistant pour Olivier, artisan en ravalement de façade et ITE. Tu ne reponds PAS a la question : tu determines de QUEL type de donnees elle releve.

QUESTION :
---
${question}
---

Reponds STRICTEMENT en JSON valide (aucun texte autour, pas de markdown), schema EXACT :
{ "domaine": "devis | inconnu" }

DOMAINES :
- "devis" : ses devis, montants, prix, chiffre d'affaires, typologies de travaux chiffrees. Exemples : "mon prix moyen sur les ravalements", "mes 3 plus gros devis", "le total de mes devis d'ITE", "combien j'ai devise pour tel client".
- "inconnu" : tout le reste (salutations, hors sujet, ou impossible a rattacher au domaine ci-dessus).

REGLE : si la question n'a rien a voir avec ses devis, reponds "inconnu".`
}

function extraireJson(texte: string): { domaine?: string } {
  const m = texte.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('Aucun JSON dans la reponse de l\'aiguilleur.')
  return JSON.parse(m[0])
}

// Classe la question dans un domaine. REPLI sur "devis" (chemin historiquement
// fiable) en cas d'echec/timeout de l'appel ou de JSON invalide : on ne degrade
// jamais le comportement devis existant a cause de ce nouvel etage.
export async function aiguiller(question: string): Promise<DomaineAssistant> {
  try {
    const rep = await anthropic.messages.create({
      model: MODELE_CLAUDE,
      max_tokens: 50,
      temperature: 0,
      messages: [{ role: 'user', content: promptAiguilleur(question) }],
    })
    const texte = rep.content[0]?.type === 'text' ? rep.content[0].text : ''
    const domaine = extraireJson(texte).domaine
    if (domaine === 'inconnu') return 'inconnu'
    return 'devis'
  } catch {
    return 'devis'
  }
}
