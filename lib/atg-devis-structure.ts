// =============================================================
// Structure de devis ATG — config centralisée
// =============================================================
// Ce fichier est LE point unique pour ajuster l'ordre des sections, les
// libellés des titres, et les mots-clés qui rattachent chaque article à une
// section transversale (Déplacement / Échafaudage / Lavage / Traitement).
//
// Après le kickoff avec Olivier, on aura ses vrais devis et il faudra
// probablement :
//   - Affiner les puces de QUALIFICATIONS ATG (numéros de certif, dates)
//   - Ajouter/renommer/réordonner les sections transversales
//   - Compléter les mots-clés pour mieux capturer les variantes de libellés
// Tout se passe ici, dans STRUCTURE_DEVIS_ATG.

export interface SectionTransversaleATG {
  // Libellé qui apparaît comme titre de section dans le devis Costructor.
  titre: string
  // Mots-clés (lowercase, accents tolérés) qui déterminent quel article
  // de la bibliothèque rattacher à cette section. Une SOUS-chaîne du libellé
  // de l'article suffit pour matcher. Premier mot-clé à matcher = section
  // attribuée (l'ordre de motsCles importe peu, mais l'ordre des sections
  // transversales détermine quel match gagne en cas de conflit).
  motsCles: string[]
}

export interface StructureDevisATG {
  entete: {
    titre: string
    // Une ligne par puce. Le rendu Costructor concatène en <strong>titre</strong>
    // suivi de la liste à puces.
    lignes: string[]
  }
  // Sections transversales émises AVANT les sections par façade, dans
  // l'ordre du tableau. Une section transversale qui ne capte aucun article
  // est tout de même émise (titre seul) pour matérialiser la structure ATG ;
  // Olivier peut y ajouter des postes manuellement côté Costructor.
  sectionsTransversales: SectionTransversaleATG[]
}

export const STRUCTURE_DEVIS_ATG: StructureDevisATG = {
  entete: {
    titre: 'QUALIFICATIONS ATG',
    lignes: [
      'ATG est certifiée Qualibat attribution 6111 Peinture et Ravalement de façade',
      'Garantie décennale',
      'Assurance professionnelle responsabilité civile',
    ],
  },
  sectionsTransversales: [
    {
      titre: 'POSTE DÉPLACEMENT',
      motsCles: ['déplacement', 'installation et repli'],
    },
    {
      titre: 'ÉCHAFAUDAGE',
      motsCles: ['échafaudage', 'protections et bâchage'],
    },
    {
      titre: 'LAVAGE',
      motsCles: [
        'préparation support haute pression',
        'nettoyage haute pression',
        'lavage',
      ],
    },
    {
      titre: 'TRAITEMENT',
      motsCles: [
        'traitement fissures',
        'algicide',
        'fongicide',
        'entoilage',
        'imperméabilité',
        'toile de renfort',
        'ouverture, brossage',
        'rebouchage',
      ],
    },
  ],
}

// Normalisation pour comparer mots-clés et libellés : lowercase + retrait des
// diacritiques (é → e, à → a, etc.) + espaces collapsés.
function normaliser(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
}

// Renvoie le titre de la section transversale qui capte cet article,
// ou null si aucune section ne match (l'article reste alors dans sa section
// façade d'origine).
export function trouverSectionTransversale(
  libelleArticle: string,
  structure: StructureDevisATG = STRUCTURE_DEVIS_ATG,
): string | null {
  const libelleNorm = normaliser(libelleArticle)
  for (const section of structure.sectionsTransversales) {
    if (section.motsCles.some((m) => libelleNorm.includes(normaliser(m)))) {
      return section.titre
    }
  }
  return null
}
