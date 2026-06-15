// =============================================================
// Metrics Parser — extrait les métrés d'une dictée vocale
// =============================================================
// Étape 1 du pré-remplissage des métrés (réparation du matcher Phase B).
// Principe : Claude PROPOSE (rattachement sémantique mesure -> articles), le
// CODE VALIDE (contrainte d'unité dure, exclusion des forfaits, section
// tolérante, fail-open). Agnostique au moteur : marche pour le devis ITE
// (clonage) ET le ravalement (plat), car les deux produisent des SectionDevis.
//
// Distinction métier (validée par Julien, expert BTP) :
//   - mesure de MUR GLOBALE (« façade sud 45 m² », sans poste nommé) -> la
//     surface couvre TOUS les postes surfaciques globaux de la section.
//   - poste PRÉCIS nommé (« l'isolant fait 45 m² », « 6 ml d'appuis ») -> ce
//     seul article.
// Lecture seule du catalogue côté amont ; ici on ne touche QUE les SectionDevis
// de l'app (aucune écriture Costructor).

import { anthropic, MODELE_CLAUDE } from './anthropic'
import { normaliser, correspondNomSouple } from './assistant/matching-nom'
import type { MetricsParseResult, SectionDevis } from './types'

// ---------- Normalisation des unités (contrainte dure) ----------

// Ramène une unité (article ou mesure) à une classe canonique. NFKD décompose
// l'exposant « ² » (U+00B2) en « 2 », donc « m² » et « m2 » convergent. Tout ce
// qui n'est pas une surface / un linéaire / un comptage (« ens », « forfait »,
// « % », « m³ »...) tombe en 'autre' : c'est ce qui exclut nativement les
// forfaits d'une mesure surfacique. On NE mappe PAS le « m » nu (ambigu).
function normaliserUnite(u: string | null | undefined): 'm2' | 'ml' | 'u' | 'autre' {
  const n = (u ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
  if (n === 'm2' || n === 'metrecarre' || n === 'metrescarres' || n === 'metrecarres') {
    return 'm2'
  }
  if (n === 'ml' || n === 'metrelineaire' || n === 'metreslineaires') return 'ml'
  if (n === 'u' || n === 'unite' || n === 'unites' || n === 'nb' || n === 'piece' || n === 'pieces') {
    return 'u'
  }
  return 'autre'
}

// Garde libellé (défense en profondeur) : un forfait fixe ne reçoit JAMAIS de
// mesure dictée, même si l'unité concordait. Mots-clés VOLONTAIREMENT étroits
// (« contribution » / « déplacement » / « déchet » / « benne ») pour ne pas
// exclure par erreur l'échafaudage (qui, lui, doit recevoir la surface du mur).
function estForfaitFixe(libelle: string): boolean {
  return /contribution|deplacement|dechet|benne/.test(normaliser(libelle))
}

// ---------- Extraction (Claude) ----------

function buildPrompt(transcription: string, sections: SectionDevis[]): string {
  const ctx = JSON.stringify(
    sections.map((s) => ({
      section: s.nom,
      articles: s.articles.map((a) => ({ libelle: a.libelle, unite: a.unite })),
    })),
  )

  return `Tu analyses une DICTÉE DE MÉTRÉS d'un professionnel de la façade (ravalement OU isolation thermique par l'extérieur). Tu ne rédiges rien et tu n'inventes aucun chiffre : tu rattaches chaque mesure dictée aux bons articles du devis.

DICTÉE :
---
${transcription}
---

STRUCTURE DU DEVIS (sections, et pour chaque article son libellé + son unité) :
---
${ctx}
---

Pour CHAQUE valeur numérique dictée, produis une "mesure" :
- "section" : le nom de la section visée (façade / pignon / zone), tel qu'il figure dans la structure.
- "valeur" : le nombre dicté.
- "unite" : "m²", "ml" ou "u". Déduis-la des mots : « mètre carré / m² / m2 » => m² ; « mètre linéaire / ml » => ml ; un comptage (« 2 volets », « un report ») => u. Tolère les fautes de transcription (« metre carre », « metre lineaire »).
- "portee" :
   - "mur" = Olivier donne UNE surface pour TOUT le mur de la façade SANS nommer de poste précis (« façade sud 45 m² », « le mur fait 45 m² »). Cette surface vaut pour TOUS les postes surfaciques qui couvrent le mur entier.
   - "poste" = Olivier nomme un poste précis avec sa propre mesure (« l'isolant fait 45 m² », « le soubassement fait 8 m² », « 12 ml de fissures », « 6 ml d'appuis », « 2 volets »).
- "articles_cibles" : la liste des LIBELLÉS EXACTS (recopiés depuis la structure) des articles concernés :
   - portee "mur" : TOUS les postes surfaciques GLOBAUX de la section qui couvrent toute la surface du mur (échafaudage, lavage / nettoyage, traitement, isolant, système / enduit, finition / imperméabilité...). N'y mets PAS les sous-surfaces (soubassement, menuiseries / contours), NI les postes en ml ou en unité.
   - portee "poste" : UNIQUEMENT le seul article nommé.
   Les libellés doivent être recopiés EXACTEMENT depuis la structure, sinon le rattachement échoue.
- "confiance" : "haute" si le rattachement est sûr, "basse" si tu hésites.

RÈGLES :
- Ne cible JAMAIS un forfait (éco-contribution, déplacement / installation de chantier, gestion des déchets / benne) : ces quantités ne se dictent pas.
- Si une mesure ne correspond à aucun article sûr, NE DEVINE PAS : mets son texte dans "ignores" et n'invente aucun libellé.
- N'invente aucune section ni aucun article absent de la structure.

Réponds STRICTEMENT en JSON valide (sans markdown, sans texte autour), schéma exact :
{
  "mesures": [
    { "section": "Façade Sud", "valeur": 45, "unite": "m²", "portee": "mur", "articles_cibles": ["<libellé exact>", "<libellé exact>"], "confiance": "haute" },
    { "section": "Façade Sud", "valeur": 12, "unite": "ml", "portee": "poste", "articles_cibles": ["<libellé exact du poste nommé>"], "confiance": "haute" }
  ],
  "ignores": []
}`
}

export async function parserMetres(
  transcription: string,
  sections: SectionDevis[],
): Promise<MetricsParseResult> {
  const reponse = await anthropic.messages.create({
    model: MODELE_CLAUDE,
    max_tokens: 2000,
    temperature: 0,
    messages: [{ role: 'user', content: buildPrompt(transcription, sections) }],
  })

  const texte =
    reponse.content[0]?.type === 'text' ? reponse.content[0].text : ''

  const match = texte.match(/\{[\s\S]*\}/)
  if (!match) {
    throw new Error('Aucun JSON trouvé dans la réponse Claude.')
  }

  const parsed = JSON.parse(match[0]) as Partial<MetricsParseResult>
  return {
    mesures: Array.isArray(parsed.mesures) ? parsed.mesures : [],
    ignores: Array.isArray(parsed.ignores) ? parsed.ignores : [],
  }
}

// ---------- Application (code, garde-fous) ----------

// Résout une section par nom : égalité normalisée d'abord, puis matching souple
// (tolérance fautes, mutualisé avec l'assistant). Fail-open : null si rien.
function trouverSection(
  sections: SectionDevis[],
  nom: string,
): SectionDevis | null {
  const cible = normaliser(nom)
  if (!cible) return null
  const exact = sections.find((s) => normaliser(s.nom) === cible)
  if (exact) return exact
  return sections.find((s) => correspondNomSouple(nom, s.nom)) ?? null
}

// Résout un article dans une section par libellé : égalité normalisée puis
// sous-chaîne (dans un sens ou l'autre). PAS de matching souple ici (libellés
// d'articles trop courts/proches : risque de viser le mauvais poste). Claude est
// tenu de recopier le libellé exact, donc l'égalité couvre le cas normal.
function trouverArticle(section: SectionDevis, libelle: string) {
  const cible = normaliser(libelle)
  if (!cible) return null
  const exact = section.articles.find((a) => normaliser(a.libelle) === cible)
  if (exact) return exact
  return (
    section.articles.find((a) => {
      const n = normaliser(a.libelle)
      return n.includes(cible) || cible.includes(n)
    }) ?? null
  )
}

// Une cible (section + article + unité) est-elle acceptable pour cette mesure ?
function ciblePosable(article: { unite: string; libelle: string }, uniteMesure: 'm2' | 'ml' | 'u'): boolean {
  if (estForfaitFixe(article.libelle)) return false // forfait jamais écrasé
  return normaliserUnite(article.unite) === uniteMesure // contrainte d'unité DURE
}

// Applique les mesures dictées au devis et recalcule les totaux.
// Garde-fous : section tolérante, contrainte d'unité dure, exclusion forfaits,
// confiance "basse" ignorée, libellé non résolu ignoré -> FAIL-OPEN (on laisse
// la quantité telle quelle, jamais de devinette). On n'écrit QUE les articles
// cibles : un poste non mentionné conserve sa quantité (la dictée fait foi
// uniquement sur ce qu'elle nomme).
export function appliquerUpdates(
  sections: SectionDevis[],
  result: MetricsParseResult,
): { sections: SectionDevis[]; total_ht: number; total_ttc: number } {
  // Clone profond simple.
  const sectionsCopie: SectionDevis[] = JSON.parse(JSON.stringify(sections))

  for (const m of result.mesures ?? []) {
    // Fail-open sur incertitude explicite.
    if (m.confiance === 'basse') continue

    const valeur = Number(m.valeur)
    if (!Number.isFinite(valeur) || valeur < 0) continue

    const uniteMesure = normaliserUnite(m.unite)
    if (uniteMesure === 'autre') continue // unité non exploitable -> on ignore

    const section = trouverSection(sectionsCopie, m.section)
    if (!section) continue // section non résolue -> on ignore

    for (const cibleLibelle of m.articles_cibles ?? []) {
      const article = trouverArticle(section, cibleLibelle)
      if (!article) continue // libellé non résolu -> on ignore
      if (!ciblePosable(article, uniteMesure)) continue // unité incohérente / forfait
      article.quantite = valeur // la dictée fait foi sur ce poste
    }
  }

  const total_ht =
    Math.round(
      sectionsCopie.reduce(
        (acc, s) =>
          acc + s.articles.reduce((sa, a) => sa + (a.quantite ?? 0) * a.prix_vente, 0),
        0,
      ) * 100,
    ) / 100

  // TVA travaux 10%.
  const total_ttc = Math.round(total_ht * 1.1 * 100) / 100

  return { sections: sectionsCopie, total_ht, total_ttc }
}
