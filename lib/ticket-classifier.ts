// =============================================================
// Analyse IA d'un ticket : thématique + titre court (serveur uniquement)
// =============================================================
// Un seul appel Claude qui renvoie la catégorie ET un titre court (3-6 mots),
// utilisés pour le tri par rubrique et l'aperçu des cartes. Best-effort : timeout
// court, défaut {categorie:'autre', titre:''}, ne throw JAMAIS.

import { anthropic, MODELE_CLAUDE } from './anthropic'
import { normaliserCategorie, type CategorieCle } from './ticket-categories'

const SYSTEME = `Tu analyses un message de support envoyé par un artisan (utilisateur d'une app métier) à son développeur.

Réponds STRICTEMENT en JSON compact : {"categorie":"...","titre":"..."}
- categorie ∈ "probleme" | "amelioration" | "question" | "autre"
  · probleme : un bug, une erreur, quelque chose qui ne marche pas.
  · amelioration : une idée d'optimisation, une suggestion, une évolution/fonctionnalité.
  · question : une demande d'information ou d'aide.
  · autre : le reste.
- titre : un résumé TRÈS court du sujet, 3 à 6 mots, sans ponctuation finale, en français (ex. "Lenteur de connexion", "Bot plus puissant sur Costructor").

Réponds UNIQUEMENT le JSON, rien d'autre.`

export async function analyserMessage(
  message: string,
): Promise<{ categorie: CategorieCle; titre: string }> {
  const texte = (message ?? '').trim()
  if (!texte) return { categorie: 'autre', titre: '' }
  try {
    const reponse = await anthropic.messages.create(
      {
        model: MODELE_CLAUDE,
        max_tokens: 80,
        temperature: 0,
        system: SYSTEME,
        messages: [{ role: 'user', content: texte.slice(0, 1500) }],
      },
      { timeout: 12000 },
    )
    const brut = reponse.content[0]?.type === 'text' ? reponse.content[0].text : ''
    // Extraction tolérante du 1er objet JSON.
    const m = brut.match(/\{[\s\S]*\}/)
    const obj = m ? (JSON.parse(m[0]) as { categorie?: string; titre?: string }) : {}
    const titre = (obj.titre ?? '').toString().trim().slice(0, 80)
    return { categorie: normaliserCategorie(obj.categorie), titre }
  } catch {
    return { categorie: 'autre', titre: '' }
  }
}
