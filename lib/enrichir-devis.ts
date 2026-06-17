// =============================================================
// Enrichissement de la proposition clonée depuis le rapport de visite
// =============================================================
// Le modèle d'Olivier est le SQUELETTE (ordre, postes standards, libellés
// techniques, prix). On l'enrichit avec ce qu'il a observé/dicté :
//   - Couche 1 : descriptions adaptées au chantier (état observé par façade,
//     style court d'Olivier), ANCRÉES sur le libellé du modèle. Seules les
//     descriptions changent ; structure et articles intacts. Fail-open.
//   - Couche 2 : ajout des points singuliers évoqués (souche, corniche,
//     descente EP...) depuis ses VRAIS articles (chercherProduitPoint). Jamais
//     inventé : un point non résolu est simplement ignoré.
//
// Anti-hallucination : on n'invente jamais un article ni un prix ; on ne touche
// jamais à la structure du modèle. Olivier valide/édite tout ensuite.

import { anthropic, MODELE_CLAUDE } from './anthropic'
import {
  chercherProduitPoint,
  type ProduitPlat,
  type PointSingulier,
} from './atg-devis-modele'
import type { ArticleDevis, SectionDevis } from './types'

// ---------- Couche 2 : ajout des points singuliers évoqués ----------

// Ajoute, en fin de proposition, une section « Points singuliers » avec les
// vrais articles correspondant aux points dictés et NON déjà présents dans le
// devis cloné. Quantités laissées vides (saisies aux métrés, lot suivant).
export function ajouterPointsSinguliers(
  sections: SectionDevis[],
  points: PointSingulier[],
  produits: ProduitPlat[],
): SectionDevis[] {
  if (!points || points.length === 0) return sections

  const dejaPresents = new Set<string>()
  for (const s of sections) for (const a of s.articles) dejaPresents.add(a.costructor_article_id)

  const articles: ArticleDevis[] = []
  for (const pt of points) {
    const prod = chercherProduitPoint(produits, pt)
    if (!prod || dejaPresents.has(prod.id)) continue // non résolu ou déjà au devis
    dejaPresents.add(prod.id)
    const libelle = (prod.name ?? '').replace(/<[^>]+>/g, '').trim()
    articles.push({
      costructor_article_id: prod.id,
      libelle,
      unite: pt.unite || '',
      prix_vente: Math.round((prod.sellPrice ?? 0)) / 100, // centimes -> euros
      quantite: null,
      // Contexte dicté en description par défaut (la couche 1 l'affinera).
      description_technique: pt.libelle?.trim() || libelle,
    })
  }
  if (articles.length === 0) return sections
  return [...sections, { nom: 'Points singuliers', articles }]
}

// ---------- Couche 1 : descriptions adaptées au chantier ----------

function buildPromptDescriptions(
  sections: SectionDevis[],
  rapport: string,
): { prompt: string; ids: string[] } {
  const items: Array<{ id: string; section: string; libelle: string }> = []
  sections.forEach((s, si) =>
    s.articles.forEach((a, ai) =>
      items.push({ id: `${si}-${ai}`, section: s.nom, libelle: a.libelle }),
    ),
  )
  const ids = items.map((i) => i.id)
  const prompt = `Tu rédiges les DESCRIPTIONS d'un devis de ravalement/ITE au STYLE EXACT de l'entreprise ATG (Olivier) : COURT, CONCRET, technique. Une à deux phrases denses, jamais un pavé.

Voici les OBSERVATIONS dictées sur le terrain par le ravaleur (le contexte réel du chantier) :
---
${rapport}
---

Voici les POSTES du devis (déjà structurés à partir du modèle d'Olivier). Pour CHAQUE poste, rédige une description de 90 à 150 caractères MAXIMUM, ancrée sur CE chantier :
- Le libellé porte déjà toute la technique : ta description AJOUTE le contexte de la façade/zone concernée (état observé, exposition, pourquoi ce poste ici), elle NE recopie PAS le libellé.
- Nomme la façade/zone (Sud, Nord, Pignon...) et l'état observé quand c'est pertinent. Différencie les façades (Sud : soleil, farinage ; Nord : humidité, mousses ; Pignon : vents, fissures).
- Vocabulaire ravalement strict. Repères produits/normes si utiles (I3/I4, DTU 42.1, Virtuotech, Baumit, Comabi).
- INTERDIT : remplissage générique ("dans les règles de l'art", "pour une finition optimale"), recopier le libellé, prix, durée, em-dash.
- Si une observation précise concerne ce poste, exploite-la ; sinon reste sobre et factuel sur la zone.

POSTES (id | section | libellé) :
${items.map((i) => `${i.id} | ${i.section} | ${i.libelle}`).join('\n')}

Réponds STRICTEMENT en JSON valide, sans texte ni markdown autour. Un objet par poste, MÊMES id :
{ "descriptions": [ { "id": "0-0", "description": "..." } ] }`
  return { prompt, ids }
}

// Réécrit les description_technique des articles clonés selon le rapport. Seules
// les descriptions sont remplacées (par id section-article) ; la structure et les
// articles restent strictement ceux du modèle. Fail-open : en cas d'échec/parse
// invalide, on renvoie les sections inchangées (descriptions du modèle conservées).
export async function enrichirDescriptions(
  sections: SectionDevis[],
  rapport: string,
): Promise<SectionDevis[]> {
  try {
    const total = sections.reduce((n, s) => n + s.articles.length, 0)
    if (total === 0 || !rapport.trim()) return sections

    const { prompt } = buildPromptDescriptions(sections, rapport)
    const rep = await anthropic.messages.create({
      model: MODELE_CLAUDE,
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    })
    const texte = rep.content[0]?.type === 'text' ? rep.content[0].text : ''
    const match = texte.match(/\{[\s\S]*\}/)
    if (!match) return sections
    const parsed = JSON.parse(match[0]) as {
      descriptions?: Array<{ id?: string; description?: string }>
    }
    const parId = new Map<string, string>()
    for (const d of parsed.descriptions ?? []) {
      if (typeof d?.id === 'string' && typeof d?.description === 'string' && d.description.trim()) {
        parId.set(d.id, d.description.trim())
      }
    }
    if (parId.size === 0) return sections

    return sections.map((s, si) => ({
      ...s,
      articles: s.articles.map((a, ai) => {
        const d = parId.get(`${si}-${ai}`)
        return d ? { ...a, description_technique: d } : a
      }),
    }))
  } catch (e) {
    console.warn('[enrichir-devis] enrichissement descriptions échoué (modèle conservé) :', (e as Error).message)
    return sections
  }
}
