// =============================================================
// Quote Proposer — propose une structure de devis enrichie depuis
// les transcriptions dictées sur le chantier et la bibliothèque Costructor.
//
// Génère en UNE passe Claude :
//   - la sélection d'articles par zone (façade)
//   - la DESCRIPTION TECHNIQUE de chaque article, ancrée dans le contexte
//     de la zone (le différenciateur "dossier d'appel d'offres")
// =============================================================

import { anthropic } from './anthropic'
import type {
  ArticleRemplacable,
  PropositionDevisIA,
  SectionDevis,
} from './types'

const MODELE_CLAUDE = 'claude-sonnet-4-20250514'

function buildPrompt(
  transcriptions: string[],
  bibliotheque: ArticleRemplacable[],
): string {
  const obsText = transcriptions
    .map((t, i) => `Observation ${i + 1} : ${t}`)
    .join('\n\n')

  const biblioJson = JSON.stringify(
    bibliotheque.map((a) => ({
      id: a.costructor_article_id,
      libelle: a.libelle,
      unite: a.unite,
      prix: a.prix_vente,
    })),
  )

  return `Tu rédiges les DESCRIPTIONS d'un devis de ravalement de façade au STYLE EXACT de l'entreprise ATG (Olivier). Son style, observé sur ses vrais devis : COURT, CONCRET, technique. Une à deux phrases denses, jamais un pavage. Une bonne description nomme la façade concernée, l'état observé, et le produit ou la norme. Zéro remplissage, zéro généralité.

CONTEXTE DU CHANTIER
Observations dictées sur le terrain par le ravaleur :
---
${obsText}
---

BIBLIOTHÈQUE D'ARTICLES (SEULE source autorisée — n'invente JAMAIS un article, un prix ou un id hors de cette liste) :
---
${biblioJson}
---

ÉTAPE 1 - STRUCTURE
1. Identifie les zones de chantier mentionnées, toujours en MAJUSCULES (ex: FAÇADE SUD, FAÇADE NORD, PIGNON EST). Olivier travaille façade par façade.
2. Pour chaque zone, sélectionne les articles de la bibliothèque qui correspondent EXACTEMENT à ce que le ravaleur a annoncé. S'il dit "I3", choisis I3, JAMAIS I4. S'il dit "I4", choisis I4. Suis son intention, ne devine pas.
3. Respecte l'ordre logique d'intervention : installation, échafaudage, lavage, traitement, puis ravalement ou ITE et points singuliers.
4. Ne propose AUCUNE quantité (les métrés seront saisis par le pro après).

ÉTAPE 2 - DESCRIPTION COURTE STYLE OLIVIER
Pour chaque article retenu, rédige UNE description de 100 à 150 caractères MAXIMUM. Le libellé de l'article porte déjà toute la technique détaillée : ta description AJOUTE le contexte de la façade (pourquoi ce poste à cet endroit), elle ne recopie pas le libellé.

RÈGLES DE STYLE (impératives) :
- 100 à 150 caractères. JAMAIS plus. Une à deux phrases courtes.
- Concret : nomme la façade, l'état observé, et un repère produit ou norme (DTU 42.1, I3 ou I4, Virtuotech, Baumit, Comabi, enduit fibré, teinte façade).
- Vocabulaire ravalement strict.

INTERDICTIONS STRICTES :
- INTERDIT : tout remplissage générique et toute tournure vague ("permet de garantir", "afin d'assurer une finition optimale", "dans les règles de l'art", "pour une parfaite adhérence"). Chaque mot doit apporter une info concrète.
- INTERDIT : recopier le libellé de l'article. Pas de paragraphes, pas de listes, pas de sauts de ligne.
- INTERDIT : prix, durée ou planning, nombre d'ouvriers, em-dash (le tiret long).
- INTERDIT : "rénovation" ou "intervention" en sens générique.

DIFFÉRENCIATION ENTRE ZONES
Si un même article apparaît sur plusieurs façades, la description doit être DIFFÉRENTE, ancrée sur l'exposition : Sud (plein soleil, farinage, dilatation), Nord (humidité, mousses, gel-dégel), Pignon (vents dominants, pluies battantes, fissures).

EXEMPLES DE STYLE ATTENDU (longueur et registre à imiter, tirés des vrais devis d'Olivier) :
- "Façade Sud plein soleil, ancien revêtement fariné. Ravalement I3 Virtuotech après traitement des fissures à l'enduit fibré."
- "Accès façade Nord par échafaudage Comabi R200, montage conforme NF, protections et repli compris."
- "Pignon Est, fissures actives sur toute la hauteur. Imperméabilisation I4 avec entoilage et marouflage toile antifissure."

FORMAT DE SORTIE
Réponds STRICTEMENT en JSON valide, sans markdown, sans texte avant ou après. Schéma exact :

{
  "sections": [
    {
      "nom": "FAÇADE SUD",
      "articles": [
        {
          "costructor_article_id": "<id exact bibliothèque>",
          "libelle": "<libellé exact bibliothèque>",
          "unite": "<unité exacte bibliothèque>",
          "prix_vente": <prix exact bibliothèque>,
          "quantite": null,
          "description_technique": "Une à deux phrases, 100 à 150 caractères, style Olivier."
        }
      ]
    }
  ]
}`
}

export async function proposerDevis(
  transcriptions: string[],
  bibliotheque: ArticleRemplacable[],
): Promise<SectionDevis[]> {
  if (bibliotheque.length === 0) {
    throw new Error(
      'Bibliothèque Costructor vide. Vérifie la table bibliotheque_costructor.',
    )
  }
  if (transcriptions.length === 0) {
    throw new Error('Aucune observation à analyser.')
  }

  const reponse = await anthropic.messages.create({
    model: MODELE_CLAUDE,
    max_tokens: 6000,
    messages: [{ role: 'user', content: buildPrompt(transcriptions, bibliotheque) }],
  })

  const texte =
    reponse.content[0]?.type === 'text' ? reponse.content[0].text : ''

  const match = texte.match(/\{[\s\S]*\}/)
  if (!match) {
    throw new Error('Aucun JSON trouvé dans la réponse Claude.')
  }

  const parsed = JSON.parse(match[0]) as PropositionDevisIA

  // Whitelist serveur : on garde uniquement les articles dont l'id existe en bibliothèque.
  // On préserve la description_technique générée.
  const idsConnus = new Set(bibliotheque.map((a) => a.costructor_article_id))
  const sectionsFiltrees: SectionDevis[] = parsed.sections.map((s) => ({
    nom: s.nom,
    articles: s.articles
      .filter((a) => {
        const ok = idsConnus.has(a.costructor_article_id)
        if (!ok) {
          console.warn(
            `[quote-proposer] article hors bibliothèque ignoré : ${a.libelle} (${a.costructor_article_id})`,
          )
        }
        return ok
      })
      .map((a) => ({
        ...a,
        // Fallback si jamais la description n'a pas été générée.
        description_technique:
          a.description_technique?.trim() || a.libelle,
      })),
  }))

  return sectionsFiltrees
}
