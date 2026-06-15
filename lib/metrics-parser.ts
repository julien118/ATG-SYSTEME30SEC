// =============================================================
// Metrics Parser — extrait les métrés d'une dictée vocale
// =============================================================

import { anthropic, MODELE_CLAUDE } from './anthropic'
import type { MetricsParseResult, SectionDevis } from './types'

function buildPrompt(transcription: string, sections: SectionDevis[]): string {
  const ctx = JSON.stringify(
    sections.map((s) => ({
      section_name: s.nom,
      articles: s.articles.map((a) => ({
        libelle: a.libelle,
        unite: a.unite,
      })),
    })),
  )

  return `Tu es un parser de métrés dictés par un professionnel du ravalement.

Voici la transcription audio :
---
${transcription}
---

Voici la structure actuelle du devis (sections + articles disponibles) :
---
${ctx}
---

Ta mission : identifier toutes les valeurs numériques mentionnées et les rattacher aux bons articles dans les bonnes sections.

Règles :
- "mètre carré", "m²", "m2", "metre carre" → unité m²
- "mètre linéaire", "ml", "mètres" (dans contexte ml) → unité ml
- Tolérance aux fautes de transcription : "métre", "metre carre", etc.
- "Façade sud 45 m²" : cible l'article principal de finition de la section (I3 taloché, peinture décorative, imperméabilité) car c'est lui qui porte la surface globale. Attribue aussi 45 m² à l'article "Préparation support haute pression" de la même section si présent.
- "12 mètres linéaires de fissures" → article "Traitement fissures en escalier"
- "8 mètres linéaires d'entoilage" → article "Entoilage partiel sur fissures"
- "Pignon est 6 mètres linéaires de fissures et 15 m²" → 6 sur "Traitement fissures en escalier", 15 sur "Imperméabilité I3 finition peinture"
- Si ambigu, ignorer plutôt que deviner.

Réponds STRICTEMENT au format JSON, sans markdown, sans texte avant/après :

{
  "updates": [
    {
      "section_name": "FAÇADE SUD",
      "article_label": "Ravalement façade système I3 taloché",
      "quantity": 45,
      "confidence": "high"
    }
  ],
  "ignored": []
}`
}

export async function parserMetres(
  transcription: string,
  sections: SectionDevis[],
): Promise<MetricsParseResult> {
  const reponse = await anthropic.messages.create({
    model: MODELE_CLAUDE,
    max_tokens: 1500,
    messages: [{ role: 'user', content: buildPrompt(transcription, sections) }],
  })

  const texte =
    reponse.content[0]?.type === 'text' ? reponse.content[0].text : ''

  const match = texte.match(/\{[\s\S]*\}/)
  if (!match) {
    throw new Error('Aucun JSON trouvé dans la réponse Claude.')
  }

  return JSON.parse(match[0]) as MetricsParseResult
}

// Applique les updates au devis et recalcule les totaux.
export function appliquerUpdates(
  sections: SectionDevis[],
  result: MetricsParseResult,
): { sections: SectionDevis[]; total_ht: number; total_ttc: number } {
  // Clone profond simple.
  const sectionsCopie: SectionDevis[] = JSON.parse(JSON.stringify(sections))

  for (const u of result.updates) {
    const section = sectionsCopie.find(
      (s) => s.nom.toLowerCase() === u.section_name.toLowerCase(),
    )
    if (!section) continue

    // Matching tolérant sur le libellé (contient ou est contenu).
    const cible = u.article_label.toLowerCase()
    const article = section.articles.find(
      (a) =>
        a.libelle.toLowerCase() === cible ||
        a.libelle.toLowerCase().includes(cible) ||
        cible.includes(a.libelle.toLowerCase()),
    )
    if (!article) continue

    article.quantite = u.quantity
  }

  const total_ht = sectionsCopie.reduce(
    (acc, s) =>
      acc +
      s.articles.reduce(
        (sa, a) => sa + (a.quantite ?? 0) * a.prix_vente,
        0,
      ),
    0,
  )

  // TVA travaux 10%.
  const total_ttc = Math.round(total_ht * 1.1 * 100) / 100

  return { sections: sectionsCopie, total_ht, total_ttc }
}
