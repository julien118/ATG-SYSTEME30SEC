// =============================================================
// Routing par typologie (Phase D)
// =============================================================
// À partir d'une dictée transcrite, détecte la typologie de chantier et
// sélectionne le devis-modèle correspondant parmi les 5 modèles utiles du
// compte test.
//
// Acquis Phase A : il n'y a PAS de bibliothèque/catégorie en API. La structure
// d'Olivier est portée par ses devis-modèles (`model:true`). On ne cherche donc
// PAS dans les milliers de produits : on route vers le bon modèle, puis on le
// clone.
//
// PRIORITÉ DE SÉCURITÉ : on tranche d'abord la FAMILLE (ravalement vs ITE) de
// façon franche, AVANT d'affiner la variante. Une dictée de ravalement ne doit
// JAMAIS tomber sur un modèle ITE, et inversement.
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
export type Famille = 'ravalement' | 'ite' | 'inconnue'

export interface ResultatRoutage {
  famille: Famille
  typologie: string // clé interne (ex: 'ravalement_i3_peinture')
  libelle: string
  modeleId: string | null
  modeleDescription: string | null
  confiance: NiveauConfiance
  // Marge de separation de famille (|scoreIte - scoreRav|). Signal FRANC de
  // « clairement ITE » ou « clairement ravalement », independant de l'unicite du
  // modele. Sert d'aiguilleur (commit 2) la ou la confiance globale, qui exige un
  // modele unique, retombe a 'basse' sur des repliques identiques du compte test.
  margeFamille: number
  raison: string
  alternatives: Array<{ typologie: string; libelle: string; score: number }>
}

interface DefinitionTypologie {
  cle: string
  libelle: string
  famille: Exclude<Famille, 'inconnue'>
  // Signaux dans la dictée qui distinguent cette variante DANS sa famille.
  motsCles: Array<{ re: RegExp; poids: number }>
  // Prédicat sur la description (HTML strippé + normalisée) du modèle.
  matchModele: (descNorm: string) => boolean
}

// --- Détection de FAMILLE (1er niveau, franc) ---
// Mots-clés ITE forts : tout ce qui évoque l'isolation par l'extérieur.
const MOTS_ITE: Array<{ re: RegExp; poids: number }> = [
  { re: /\bite\b/, poids: 3 },
  { re: /isolation thermique|isolation par l.?ext|isoler? par l.?ext|isolation exterieure/, poids: 3 },
  { re: /\bisolant\b|polystyr|\bpse\b|starsystem|star system|baumit|knauf|weber|protherm|acermi/, poids: 2 },
  { re: /\br ?= ?\d|epaisseur.*\d+ ?mm|\d+ ?mm.*(isol|pse|panneau)/, poids: 1 },
]
// Mots-clés RAVALEMENT forts : finition de façade sans isolation.
const MOTS_RAVALEMENT: Array<{ re: RegExp; poids: number }> = [
  { re: /ravalement/, poids: 3 },
  { re: /\bi3\b|\bi4\b/, poids: 2 },
  { re: /peinture|virtuotech|taloch/, poids: 2 },
  { re: /fissures|enduit|farin|imperm/, poids: 1 },
]

const TYPOLOGIES: DefinitionTypologie[] = [
  {
    cle: 'ravalement_i3_peinture',
    libelle: 'Ravalement I3 peinture',
    famille: 'ravalement',
    motsCles: [
      { re: /\bi3\b/, poids: 2 },
      { re: /peinture|virtuotech/, poids: 2 },
    ],
    matchModele: (d) => /i3\s*peinture/.test(d),
  },
  {
    cle: 'ravalement_i3_taloche',
    libelle: 'Ravalement I3 taloché',
    famille: 'ravalement',
    motsCles: [
      { re: /\bi3\b/, poids: 2 },
      { re: /taloch/, poids: 2 },
    ],
    matchModele: (d) => /i3\s*taloch/.test(d),
  },
  {
    cle: 'ravalement_i4_taloche',
    libelle: 'Ravalement I4 taloché',
    famille: 'ravalement',
    motsCles: [
      { re: /\bi4\b/, poids: 3 },
      { re: /taloch|entoilage/, poids: 1 },
    ],
    matchModele: (d) => /i4\s*taloch/.test(d),
  },
  {
    cle: 'ite_detaille',
    libelle: 'ITE détaillée (volets, reports, partie chauffée — garantie décennale)',
    famille: 'ite',
    motsCles: [
      { re: /volet|equerre|gond|couvertine/, poids: 2 },
      { re: /report|eclairage|robinet|partie chauffee|partie non chauffee/, poids: 2 },
      { re: /garantie decennale|tableaux isoles/, poids: 1 },
    ],
    matchModele: (d) => /garantie decennale|travaux d.isolation thermique/.test(d),
  },
  {
    cle: 'ite_standard',
    libelle: 'ITE standard (StarSystem)',
    famille: 'ite',
    motsCles: [{ re: /isolation thermique|\bite\b|starsystem/, poids: 1 }],
    matchModele: (d) =>
      /isolation thermique/.test(d) && !/garantie decennale/.test(d),
  },
]

function normaliser(s: string): string {
  return (s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreFamille(
  texte: string,
  mots: Array<{ re: RegExp; poids: number }>,
): number {
  return mots.reduce((s, { re, poids }) => s + (re.test(texte) ? poids : 0), 0)
}

export interface ScoreVariante {
  typologie: string
  libelle: string
  score: number
}

// Score les variantes d'une famille donnée.
export function scorerVariantes(dictee: string, famille: Famille): ScoreVariante[] {
  const texte = normaliser(dictee)
  return TYPOLOGIES.filter((t) => t.famille === famille)
    .map((t) => ({
      typologie: t.cle,
      libelle: t.libelle,
      score: t.motsCles.reduce(
        (s, { re, poids }) => s + (re.test(texte) ? poids : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score)
}

// Sélectionne le modèle correspondant à la dictée.
export function selectionnerModele(
  dictee: string,
  modeles: ModeleDevis[],
): ResultatRoutage {
  const texte = normaliser(dictee)

  // --- 1er niveau : FAMILLE (franc) ---
  const scoreIte = scoreFamille(texte, MOTS_ITE)
  const scoreRav = scoreFamille(texte, MOTS_RAVALEMENT)

  // Modèles exploitables : modèle vrai, décrit, non artefact, total > 0.
  const modelesUtiles = modeles.filter(
    (m) =>
      m.model &&
      (m.description ?? '').trim().length > 0 &&
      !/test.*supprimer/i.test(m.description ?? '') &&
      (m.total ?? 0) > 0,
  )

  if (scoreIte === 0 && scoreRav === 0) {
    return {
      famille: 'inconnue',
      typologie: 'inconnue',
      libelle: 'Typologie non détectée',
      modeleId: null,
      modeleDescription: null,
      confiance: 'aucune',
      margeFamille: 0,
      raison:
        'Aucun mot-clé de famille (ravalement / peinture / taloché / ITE / isolation...) trouvé. Routage manuel requis.',
      alternatives: [],
    }
  }

  const famille: Famille = scoreIte > scoreRav ? 'ite' : 'ravalement'
  const margeFamille = Math.abs(scoreIte - scoreRav)

  // --- 2e niveau : VARIANTE dans la famille ---
  const variantes = scorerVariantes(dictee, famille)
  const meilleure = variantes[0]
  const seconde = variantes[1]
  const def = TYPOLOGIES.find((t) => t.cle === meilleure.typologie)!

  const candidats = modelesUtiles
    .filter((m) => def.matchModele(normaliser(m.description ?? '')))
    // Choix deterministe parmi des repliques (compte test) : on prend la PLUS
    // RECENTE. Les ids Costructor sont des ULID ordonnes dans le temps ; sur le
    // compte test, d'anciennes repliques restent listees mais renvoient 404 au
    // detail (_expand=lines), alors que la replique la plus recente est la bonne.
    // Tri par id DECROISSANT = plus recent d'abord. Si meme ce choix echoue a la
    // lecture, l'aiguillage retombe sur le moteur plat (fail-safe cote route).
    .sort((a, b) => b.id.localeCompare(a.id))

  const alternatives = variantes
    .filter((v) => v.typologie !== meilleure.typologie && v.score > 0)
    .map((v) => ({ typologie: v.typologie, libelle: v.libelle, score: v.score }))

  if (candidats.length === 0) {
    return {
      famille,
      typologie: meilleure.typologie,
      libelle: meilleure.libelle,
      modeleId: null,
      modeleDescription: null,
      confiance: 'aucune',
      margeFamille,
      raison: `Famille « ${famille} » (ITE=${scoreIte} / ravalement=${scoreRav}) mais aucun modèle « ${meilleure.libelle} » sur le compte test.`,
      alternatives,
    }
  }

  // Confiance : la séparation de famille prime. Marge famille forte + variante
  // nette + 1 seul modèle candidat = haute.
  const margeVariante = meilleure.score - (seconde?.score ?? 0)
  let confiance: NiveauConfiance
  if (margeFamille >= 3 && margeVariante >= 2 && candidats.length === 1)
    confiance = 'haute'
  else if (margeFamille >= 2 && candidats.length === 1) confiance = 'moyenne'
  else confiance = 'basse'

  const choisi = candidats[0]
  const ambig =
    candidats.length > 1
      ? ` ⚠️ ${candidats.length} modèles matchent (${candidats
          .map((c) => `"${normaliser(c.description ?? '')}"`)
          .join(', ')}) — premier retenu, à valider.`
      : ''

  return {
    famille,
    typologie: meilleure.typologie,
    libelle: meilleure.libelle,
    modeleId: choisi.id,
    modeleDescription: (choisi.description ?? '').replace(/<[^>]+>/g, '').trim(),
    confiance,
    margeFamille,
    raison: `Famille ${famille} (ITE=${scoreIte}/rav=${scoreRav}, marge ${margeFamille}) ; variante « ${meilleure.libelle} » score ${meilleure.score} (marge ${margeVariante} sur « ${seconde?.libelle ?? '—'} »).${ambig}`,
    alternatives,
  }
}

// =============================================================
// Sélection ROBUSTE du modèle (clonage généralisé à TOUTES les typologies)
// =============================================================
// Plutôt que des prédicats codés en dur sur la description (fragiles dès qu'Olivier
// renomme/édite ses modèles), on SCORE chaque modèle LIVE par recouvrement de mots
// discriminants entre le SIGNAL (objet des travaux + dictée) et le NOM + la
// description du modèle. Robuste aux renommages : tant que le nom reflète le type
// (« Ravalement I3 taloché », « ITE… »), le bon modèle ressort. C'est une
// PRÉ-SÉLECTION best-effort : le sélecteur hybride côté UI laisse toujours Olivier
// confirmer ou changer depuis la liste live de ses modèles.

// Un poids est compté quand le mot apparaît À LA FOIS dans le signal ET dans le
// nom/description du modèle. Les variantes proches (I3 taloché vs I3 peinture) se
// départagent par leurs mots propres (taloch / peinture).
const MOTS_TYPE_MODELE: Array<{ re: RegExp; poids: number }> = [
  { re: /\bite\b|isolation thermique|isolation par l.?ext|isolation exterieure|isolant|polystyr|\bpse\b|baumit|starsystem/, poids: 3 },
  { re: /\bi4\b/, poids: 3 },
  { re: /\bi3\b/, poids: 2 },
  { re: /taloch/, poids: 2 },
  { re: /peinture|virtuotech/, poids: 2 },
  { re: /ravalement/, poids: 1 },
]

export interface ModeleDispo {
  id: string
  libelle: string
}

export interface ChoixModele {
  modeleId: string | null
  libelle: string | null
  score: number
  // true si deux modèles arrivent ex aequo (l'UI invite alors à confirmer).
  ambigu: boolean
  // Liste complète des modèles exploitables (pour le sélecteur hybride).
  modelesDisponibles: ModeleDispo[]
  alternatives: Array<{ id: string; libelle: string; score: number }>
}

// Modèles réellement exploitables : vrai modèle (model:true) + non vide (total>0).
// On NE requiert PAS de description (un modèle valide peut en être dépourvu, ex.
// « Isolation thermique par l'extérieur »). On écarte les brouillons de test.
export function modelesReels(modeles: ModeleDevis[]): ModeleDevis[] {
  return modeles.filter(
    (m) => m.model && (m.total ?? 0) > 0 && !/test.*supprimer/i.test(`${m.name ?? ''} ${m.description ?? ''}`),
  )
}

export function choisirModele(signal: string, modeles: ModeleDevis[]): ChoixModele {
  const sig = normaliser(signal)
  const reels = modelesReels(modeles)
  const modelesDisponibles: ModeleDispo[] = reels.map((m) => ({
    id: m.id,
    libelle: (m.name ?? '').trim() || normaliser(m.description ?? '').slice(0, 48) || m.id,
  }))

  const scored = reels
    .map((m) => {
      const cible = normaliser(`${m.name ?? ''} ${m.description ?? ''}`)
      const score = MOTS_TYPE_MODELE.reduce(
        (s, { re, poids }) => s + (re.test(sig) && re.test(cible) ? poids : 0),
        0,
      )
      return { id: m.id, libelle: (m.name ?? '').trim() || m.id, score, total: m.total ?? 0 }
    })
    // Tri : meilleur score d'abord ; à égalité, le modèle le plus complet (total).
    .sort((a, b) => b.score - a.score || b.total - a.total)

  const meilleur = scored[0]
  const second = scored[1]
  if (!meilleur || meilleur.score === 0) {
    return { modeleId: null, libelle: null, score: 0, ambigu: false, modelesDisponibles, alternatives: [] }
  }
  return {
    modeleId: meilleur.id,
    libelle: meilleur.libelle,
    score: meilleur.score,
    ambigu: !!second && second.score === meilleur.score,
    modelesDisponibles,
    alternatives: scored
      .filter((s) => s.id !== meilleur.id && s.score > 0)
      .map(({ id, libelle, score }) => ({ id, libelle, score })),
  }
}
