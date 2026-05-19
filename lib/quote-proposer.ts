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
  ArticleBibliotheque,
  PropositionDevisIA,
  SectionDevis,
} from './types'

const MODELE_CLAUDE = 'claude-sonnet-4-20250514'

function buildPrompt(
  transcriptions: string[],
  bibliotheque: ArticleBibliotheque[],
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

  return `Tu rédiges un DOSSIER TECHNIQUE DE RAVALEMENT DE FAÇADE de niveau dossier d'appel d'offres. Le ravaleur dit textuellement de son métier : "Je vends de la technique, pas un prix. Mes devis font 4 pages. Tout est répertorié, hyper précis, pas d'ambiguïté." Et de son inspiration : "Notre prestataire qui gère les appels d'offres fait des dossiers de dingue, c'est hyper bien construit." C'est ce niveau de richesse technique qu'on attend de toi.

CONTEXTE DU CHANTIER
Observations dictées sur le terrain par le ravaleur :
---
${obsText}
---

BIBLIOTHÈQUE D'ARTICLES COSTRUCTOR (seule source d'articles autorisés) :
---
${biblioJson}
---

TA MISSION EN 2 ÉTAPES

ÉTAPE 1 - STRUCTURE
1. Identifie les zones de chantier mentionnées (toujours en MAJUSCULES, ex: FAÇADE SUD, FAÇADE NORD, PIGNON EST). Le ravaleur l'a dit : "Pour un ravalement, on va faire face par face. J'analyse les points que je vais devoir traiter de manière particulière."
2. Pour chaque zone, sélectionne les articles de la bibliothèque qui correspondent EXACTEMENT à ce que le ravaleur a annoncé. Si le ravaleur dit "I3", choisis I3, JAMAIS I4. S'il dit "I4", choisis I4. Suis son intention, ne devine pas.
3. Respecte l'ordre logique d'intervention : préparation, traitement, entoilage, finition.
4. N'invente JAMAIS un article ou un prix hors bibliothèque.
5. Ne propose AUCUNE quantité (les métrés seront saisis par le pro après).

ÉTAPE 2 - DESCRIPTION TECHNIQUE DENSE ET JUSTIFIÉE
Pour chaque article retenu, rédige une description technique dense, de niveau dossier d'appel d'offres. Le ravaleur pourra ajuster ensuite, mais tu dois fournir un premier jet déjà très complet pour lui faire gagner un maximum de temps.

PUBLIC CIBLE : un particulier propriétaire qui lit son devis et veut comprendre pourquoi on lui propose ça. Un maître d'oeuvre ou un architecte doit valider la justesse technique.

STRUCTURE OBLIGATOIRE EN 3 PARAGRAPHES SÉPARÉS PAR DES SAUTS DE LIGNE :

Paragraphe 1 - CONTEXTE ET DIAGNOSTIC (2 à 3 phrases) :
Cite la zone précise (Façade Sud, Façade Nord, Pignon Est) et l'élément spécifique observé sur cette zone par le ravaleur (ex: fissures en escalier sur partie haute, façade saine, fissures actives sur toute la hauteur, exposition plein soleil). Explique pourquoi cette zone exige ce poste précis.

Paragraphe 2 - MISE EN OEUVRE TECHNIQUE (3 à 5 phrases) :
Détaille concrètement les étapes du chantier sur ce poste : préparation, gestes, matériel, produits employés. Cite des références techniques : norme professionnelle DTU 42.1, mortier fibré classe R2, primaire d'accrochage acrylique, calicot polyester de renfort, classifications I3/I4 du CSTB, etc. Explique brièvement chaque référence pour rester accessible au client final.

Paragraphe 3 - FINITION ET PÉRENNITÉ (1 à 2 phrases) :
Décris la finition attendue (aspect visuel, texture, couleur si pertinent) et la garantie de durée associée à la mise en oeuvre (résistance aux intempéries, durabilité, garantie décennale si applicable).

LONGUEUR ATTENDUE
- Postes simples (préparation HP, installation, protections, échafaudage) : 350 à 500 caractères. Tu peux fusionner Paragraphe 2 et 3 si nécessaire mais le diagnostic doit rester séparé.
- Postes techniques (I3 taloché, imperméabilité I3 ou I4, entoilage, traitement fissures, ravalement minéral, peinture décorative) : 600 à 900 caractères, structure 3 paragraphes obligatoire.

DIFFÉRENCIATION OBLIGATOIRE ENTRE ZONES
Si le même article apparaît sur plusieurs zones (ex: Préparation haute pression sur Façade Sud ET Façade Nord), les descriptions doivent être TOTALEMENT DIFFÉRENTES, contextualisées à chaque exposition :
- Façade Sud : plein soleil, salissures de pollution carbonée, mousses sèches, dilatation thermique, dégradations UV, contraintes hygrométriques fortes.
- Façade Nord : humidité persistante, développement de mousses et lichens, dégradations liées au gel-dégel, ombre dominante toute l'année.
- Pignon (Est/Ouest) : exposition aux vents dominants, pluies battantes obliques, infiltrations latérales, contraintes structurelles.

INTERDICTIONS STRICTES
- Pas d'em-dash (le tiret long " — ").
- Pas de mention de prix dans la description.
- Pas de durée d'intervention ni de planning (ex: "en 2 jours", "sur 1 semaine"). Olivier garde la main sur les délais.
- Pas de nombre d'ouvriers ni de programmation.
- Pas de "rénovation", pas d'"intervention" en sens générique. Vocabulaire ravalement strict uniquement.
- Pas de listes à puces ni de tirets de liste dans la description (texte courant en paragraphes).
- Pas de remplissage artificiel. Chaque phrase doit apporter une information technique nouvelle.

FORMAT DE SORTIE
Réponds STRICTEMENT en JSON valide, sans markdown, sans texte avant ou après. Les sauts de ligne entre paragraphes utilisent "\\n\\n" dans la chaîne JSON. Schéma exact :

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
          "description_technique": "Diagnostic ici.\\n\\nMise en oeuvre ici en plusieurs phrases.\\n\\nFinition et pérennité ici."
        }
      ]
    }
  ]
}`
}

export async function proposerDevis(
  transcriptions: string[],
  bibliotheque: ArticleBibliotheque[],
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
