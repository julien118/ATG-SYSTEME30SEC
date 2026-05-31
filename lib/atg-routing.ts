// =============================================================
// Routing par typologie (Phase D)
// =============================================================
// À partir d'une dictée transcrite, détecte la typologie de chantier et
// sélectionne le devis-modèle correspondant parmi ceux du compte test.
//
// Acquis Phase A : il n'y a PAS de bibliothèque/catégorie en API. La structure
// d'Olivier est portée par ses devis-modèles (`model:true`). On ne cherche donc
// PAS dans les 2276 produits : on route vers le bon modèle, puis on le clone.
//
// Règle : jamais de devinette silencieuse. La fonction renvoie toujours un
// niveau de confiance, la raison du choix, et les alternatives plausibles.

// Modèle tel que renvoyé par GET /quotes (champs utiles seulement).
export interface ModeleDevis {
  id: string
  name: string | null
  description: string | null
  total: number | null
  model: boolean
}

export type NiveauConfiance = 'haute' | 'moyenne' | 'basse' | 'aucune'

export interface ResultatRoutage {
  typologie: string // clé interne (ex: 'ravalement_i3_peinture')
  libelle: string // libellé lisible
  modeleId: string | null
  modeleDescription: string | null
  confiance: NiveauConfiance
  raison: string
  alternatives: Array<{ typologie: string; libelle: string; score: number }>
}

// Définition des typologies routables. Pour chaque typologie :
//   - motsCles : signaux dans la dictée (regex sur texte normalisé), pondérés.
//   - descModele : regex qui identifie le modèle correspondant via sa description.
interface DefinitionTypologie {
  cle: string
  libelle: string
  motsCles: Array<{ re: RegExp; poids: number }>
  descModele: RegExp
}

const TYPOLOGIES: DefinitionTypologie[] = [
  {
    cle: 'ravalement_i3_peinture',
    libelle: 'Ravalement I3 peinture',
    motsCles: [
      { re: /\bi3\b/, poids: 2 },
      { re: /peinture|virtuotech/, poids: 2 },
      { re: /ravalement/, poids: 1 },
    ],
    descModele: /i3\s*peinture/i,
  },
  {
    cle: 'ravalement_i3_taloche',
    libelle: 'Ravalement I3 taloché',
    motsCles: [
      { re: /\bi3\b/, poids: 2 },
      { re: /taloch/, poids: 2 },
      { re: /ravalement/, poids: 1 },
    ],
    descModele: /i3\s*taloch/i,
  },
  {
    cle: 'ravalement_i4_taloche',
    libelle: 'Ravalement I4 taloché',
    motsCles: [
      { re: /\bi4\b/, poids: 2 },
      { re: /taloch|entoilage/, poids: 1 },
      { re: /ravalement/, poids: 1 },
    ],
    descModele: /i4\s*taloch/i,
  },
  {
    cle: 'ite',
    libelle: 'ITE (isolation thermique par l\'extérieur)',
    motsCles: [
      { re: /\bite\b/, poids: 3 },
      { re: /isolation thermique|isolation par l.?ext/, poids: 2 },
      { re: /polystyr|\bpse\b|baumit|starsystem|knauf|weber/, poids: 1 },
    ],
    descModele: /isolation thermique|\bite\b/i,
  },
]

// Normalisation : minuscules + retrait des diacritiques.
function normaliser(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Score chaque typologie sur la dictée (somme des poids des mots-clés présents).
export function scorerTypologies(
  dictee: string,
): Array<{ typologie: string; libelle: string; score: number }> {
  const texte = normaliser(dictee)
  return TYPOLOGIES.map((t) => {
    let score = 0
    for (const { re, poids } of t.motsCles) {
      if (re.test(texte)) score += poids
    }
    return { typologie: t.cle, libelle: t.libelle, score }
  }).sort((a, b) => b.score - a.score)
}

// Sélectionne le modèle correspondant à la typologie détectée.
// Écarte les modèles inexploitables : artefact de test, modèles vides (total 0
// ou pas de description). Si plusieurs modèles matchent la même typologie (cas
// des deux modèles ITE), on les remonte en alternatives et on baisse la confiance.
export function selectionnerModele(
  dictee: string,
  modeles: ModeleDevis[],
): ResultatRoutage {
  const scores = scorerTypologies(dictee)
  const meilleur = scores[0]
  const second = scores[1]

  // Modèles exploitables seulement.
  const modelesUtiles = modeles.filter(
    (m) =>
      m.model &&
      (m.description ?? '').trim().length > 0 &&
      !/test.*supprimer/i.test(m.description ?? '') &&
      (m.total ?? 0) > 0,
  )

  const alternatives = scores
    .filter((s) => s.score > 0 && s.typologie !== meilleur.typologie)
    .map((s) => ({ typologie: s.typologie, libelle: s.libelle, score: s.score }))

  // Aucun signal : on ne devine pas.
  if (!meilleur || meilleur.score === 0) {
    return {
      typologie: 'inconnue',
      libelle: 'Typologie non détectée',
      modeleId: null,
      modeleDescription: null,
      confiance: 'aucune',
      raison:
        'Aucun mot-clé de typologie (I3, I4, peinture, taloché, ITE...) trouvé dans la dictée. Routage manuel requis.',
      alternatives,
    }
  }

  const def = TYPOLOGIES.find((t) => t.cle === meilleur.typologie)!
  const candidats = modelesUtiles.filter((m) =>
    def.descModele.test(m.description ?? ''),
  )

  if (candidats.length === 0) {
    return {
      typologie: meilleur.typologie,
      libelle: meilleur.libelle,
      modeleId: null,
      modeleDescription: null,
      confiance: 'aucune',
      raison: `Typologie « ${meilleur.libelle} » détectée mais aucun modèle correspondant sur le compte test (regex ${def.descModele}).`,
      alternatives,
    }
  }

  // Confiance : haute si un seul modèle candidat ET marge nette sur le 2e score.
  const marge = meilleur.score - (second?.score ?? 0)
  let confiance: NiveauConfiance
  if (candidats.length === 1 && marge >= 2) confiance = 'haute'
  else if (candidats.length === 1 && marge >= 1) confiance = 'moyenne'
  else confiance = 'basse'

  const choisi = candidats[0]
  const ambiguiteModele =
    candidats.length > 1
      ? ` Attention : ${candidats.length} modèles matchent cette typologie (${candidats
          .map((c) => `"${c.description?.trim()}"`)
          .join(', ')}) — le premier est retenu, à valider.`
      : ''

  return {
    typologie: meilleur.typologie,
    libelle: meilleur.libelle,
    modeleId: choisi.id,
    modeleDescription: (choisi.description ?? '').trim(),
    confiance,
    raison: `Score ${meilleur.score} (marge ${marge} sur « ${second?.libelle ?? '—'} » à ${second?.score ?? 0}).${ambiguiteModele}`,
    alternatives,
  }
}
