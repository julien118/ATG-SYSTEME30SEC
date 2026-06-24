// =============================================================
// Classification IA d'un ticket (serveur uniquement)
// =============================================================
// Détermine la thématique d'un message de support via Claude. Best-effort :
// timeout court, défaut 'autre', ne throw JAMAIS (la création de ticket ne doit
// pas dépendre de la classification).

import { anthropic, MODELE_CLAUDE } from './anthropic'
import { CLES_CATEGORIES, normaliserCategorie, type CategorieCle } from './ticket-categories'

const SYSTEME = `Tu classes un message de support envoyé par un artisan (utilisateur d'une app métier) à son développeur. Réponds par UN SEUL mot-clé parmi :
- probleme : un bug, une erreur, quelque chose qui ne marche pas ou qui est cassé.
- amelioration : une idée d'optimisation, une suggestion, une demande d'évolution ou de nouvelle fonctionnalité.
- question : une demande d'information ou d'aide (« comment faire… », « est-ce possible… »).
- autre : tout le reste.
Réponds UNIQUEMENT par le mot-clé exact, en minuscules, sans ponctuation ni explication.`

export async function classifierMessage(message: string): Promise<CategorieCle> {
  const texte = (message ?? '').trim()
  if (!texte) return 'autre'
  try {
    const reponse = await anthropic.messages.create(
      {
        model: MODELE_CLAUDE,
        max_tokens: 8,
        temperature: 0,
        system: SYSTEME,
        messages: [{ role: 'user', content: texte.slice(0, 1200) }],
      },
      { timeout: 12000 },
    )
    const sortie = (reponse.content[0]?.type === 'text' ? reponse.content[0].text : '')
      .toLowerCase()
      .trim()
    // Le modèle peut renvoyer le mot exact ou l'enrober : on cherche la 1re clé connue.
    const trouve = CLES_CATEGORIES.find((c) => sortie.includes(c))
    return normaliserCategorie(trouve)
  } catch {
    return 'autre'
  }
}
