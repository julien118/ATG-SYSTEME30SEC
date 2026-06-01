// =============================================================
// Génération de devis par clonage de modèle (Phase E)
// =============================================================
// Approche (acquis Phase A) : la structure d'Olivier vit dans ses devis-modèles
// (`model:true`), répliqués sur le compte test. On NE reconstruit PAS depuis une
// bibliothèque (elle n'existe pas en API) : on GET le modèle avec `_expand=lines`,
// on reproduit fidèlement son arbre (groupes imbriqués, lignes texte, lignes
// produit avec leurs ids déjà ceux du compte test), on instancie un groupe par
// façade dictée à partir du motif répété du modèle, on remplit les métrés, on
// ajoute les points singuliers cherchés dans la liste plate, puis on POST en
// BROUILLON sur le compte test.
//
// RÈGLE 1 : toute écriture passe par `assertCompteJulien()` qui REFUSE la clé
// d'Olivier. Le compte d'Olivier n'est consulté qu'en lecture seule
// (`getDevisOlivierLectureSeule`), jamais écrit.

import { anthropic } from './anthropic'
import { uniteVersCostructorId } from './costructor'
import { composerDescriptionAvecRapport } from './rapport-pdf'

// Garde-fous de compte (RÈGLE 1) : définis dans un module neutre partagé pour
// éviter un cycle d'import avec costructor.ts. Ré-exportés ici pour que les
// scripts existants (`import { assertCompteJulien } from '../lib/atg-devis-modele'`)
// continuent de fonctionner.
import { assertCompteJulien, bannerCompte } from './costructor-compte'
export { assertCompteJulien, bannerCompte }

const BASE_URL =
  process.env.COSTRUCTOR_API_BASE_URL || 'https://api.costructor.co/external/v1'

// ---------- Types ----------

// Ligne telle que renvoyée par GET /quotes/{id}?_expand=lines.
export interface LigneModele {
  type: 'text' | 'product' | 'group'
  description?: string | null
  position?: number
  subtotal?: number | null
  quantity?: number | null
  sellPrice?: number | null
  unit?: { id: string; symbol?: string } | null
  product?: { id: string; name?: string } | null
  lines?: LigneModele[]
}

// Ligne du payload POST /quotes.
export type LignePayload =
  | { type: 'text'; description: string }
  | { type: 'group'; description: string; lines: LignePayload[] }
  | {
      type: 'product'
      product: string
      description: string
      quantity: number
      sellPrice: number
      unit: string
    }

export interface MetresFacade {
  nom: string
  surface_m2?: number | null // mur principal : ravalement OU système ITE + isolant
  dessous_toit_ml?: number | null
  appuis_ml?: number | null
  tableaux_ml?: number | null // tableaux de fenêtres isolés (ITE)
  soubassement_m2?: number | null
  menuiserie_m2?: number | null // contours/menuiseries métal peints
  couvertine_ml?: number | null
  nb_volets?: number | null // jeux de volets (équerre/gond/arrêt/butée)
  // Reports : chaque type est un poste DISTINCT avec sa propre quantité.
  nb_report_eclairage?: number | null
  nb_report_robinet?: number | null
  nb_report?: number | null // report générique (EDF/ENEDIS/électrique)
  nb_descente_ep?: number | null // modifs / descentes EP
  nb_fixation?: number | null // fixations descente EP, arrêts de volet
}

export interface MetresTransversal {
  echafaudage_m2?: number | null
  lavage_m2?: number | null
  traitement_m2?: number | null
}

export interface PointSingulier {
  type: string
  libelle: string
  quantite: number
  unite: string
}

export interface MetresDevis {
  facades: MetresFacade[]
  transversal: MetresTransversal
  points_singuliers: PointSingulier[]
}

export interface ProduitPlat {
  id: string
  name: string
  unit?: string | { id: string } | null
  sellPrice?: number | null
}

// ---------- Lecture compte test (GET) ----------

async function getJulien<T>(path: string): Promise<T> {
  const key = process.env.COSTRUCTOR_API_KEY
  if (!key) throw new Error('COSTRUCTOR_API_KEY manquante.')
  const r = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`Costructor ${r.status} sur ${path} : ${await r.text()}`)
  const j = (await r.json()) as { data?: T } & T
  return j.data !== undefined ? (j.data as T) : (j as T)
}

export async function listerModeles(): Promise<LigneModele[]> {
  // _limit élevé : la liste est plafonnée à 10 sans ce paramètre.
  const tous = await getJulien<any[]>('/quotes?_limit=1000')
  return tous.filter((q) => q.model)
}

export async function getModeleExpand(id: string): Promise<any> {
  return getJulien<any>(`/quotes/${id}?_expand=lines`)
}

let cacheProduits: ProduitPlat[] | null = null
export async function listerProduitsPlats(): Promise<ProduitPlat[]> {
  if (cacheProduits) return cacheProduits
  const items = await getJulien<ProduitPlat[]>('/products?_limit=3000')
  cacheProduits = items
  return items
}

// ---------- Lecture compte Olivier (GET STRICTEMENT — jamais d'écriture) ----------

export async function getDevisOlivierLectureSeule(path: string): Promise<any> {
  const key = process.env.COSTRUCTOR_API_KEY_OLIVIER
  if (!key) throw new Error('COSTRUCTOR_API_KEY_OLIVIER manquante.')
  // GET only. Aucune autre méthode HTTP n'est émise vers ce compte.
  const r = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`Costructor (Olivier, GET) ${r.status} sur ${path}`)
  const j = (await r.json()) as { data?: any } & any
  return j.data !== undefined ? j.data : j
}

// ---------- Rôle d'un produit (par sa description) ----------

function normaliser(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export type RoleProduit =
  | 'echafaudage'
  | 'lavage'
  | 'traitement'
  | 'deplacement'
  | 'dechets'
  | 'eco'
  | 'ravalement' // finition de mur au m² (I3/I4 peinture ou taloché)
  | 'ite_systeme' // système d'isolation extérieure au m²
  | 'isolant_pse' // panneau isolant PSE au m²
  | 'soubassement'
  | 'menuiserie' // contours/menuiseries métal (m²)
  | 'dessous_toit'
  | 'appuis'
  | 'tableaux'
  | 'couvertine'
  | 'volet'
  | 'report_eclairage'
  | 'report_robinet'
  | 'report' // report générique (EDF/ENEDIS/électrique)
  | 'descente_ep'
  | 'fixation'
  | 'autre'

// Détermine le rôle d'un produit d'après sa description. L'ORDRE compte :
// on teste les libellés les plus spécifiques d'abord.
export function roleProduit(description: string | null | undefined): RoleProduit {
  const d = normaliser(description)
  // Transversaux / forfaits
  if (/echafaudage|comabi|amene du materiel/.test(d)) return 'echafaudage'
  if (/lavage/.test(d)) return 'lavage'
  if (/algicide|fongicide/.test(d)) return 'traitement'
  if (/deplacement|installation du chantier/.test(d)) return 'deplacement'
  if (/gestion des dechets|benne dib/.test(d)) return 'dechets'
  if (/eco-?contribution/.test(d)) return 'eco'
  // Points de façade
  if (/dessous de toit/.test(d)) return 'dessous_toit'
  if (/tableaux de fenetres/.test(d)) return 'tableaux'
  if (/appuis de fenetres|appuis/.test(d)) return 'appuis'
  if (/soubassement/.test(d)) return 'soubassement'
  if (/couvertine/.test(d)) return 'couvertine'
  if (/equerre|gond de volet|arret de volet|butee de volet/.test(d)) return 'volet'
  // Reports : chaque type a son rôle propre (poste distinct, qté propre).
  if (/report.*eclairage|eclairage.*report|report 1 eclairage/.test(d)) return 'report_eclairage'
  if (/report.*robinet|robinet.*report|report 1 robinet/.test(d)) return 'report_robinet'
  if (/report.*(edf|enedis|electrique)/.test(d)) return 'report'
  if (/descente ep|descente d.?eau pluviale|modification descente/.test(d)) return 'descente_ep'
  if (/fixation pour descente|cylindre de fixation/.test(d)) return 'fixation'
  if (/menuiseries exterieure|contours de fenetres/.test(d)) return 'menuiserie'
  // Murs au m²
  if (/isolation thermique exterieur|starsystem|star system/.test(d)) return 'ite_systeme'
  if (/\bpse\b|protherm|cellomur|knauf therm|polystyrene/.test(d)) return 'isolant_pse'
  if (/ravalement i\d|finition taloch|i3 peinture|virtuotech|vigne vierge/.test(d)) return 'ravalement'
  return 'autre'
}

// Mesure de façade pilotant la quantité d'un rôle (null = on garde la qté
// modèle ; rôle absent de la table en contexte façade = ligne abandonnée).
const MESURE_FACADE: Partial<Record<RoleProduit, keyof MetresFacade>> = {
  ravalement: 'surface_m2',
  ite_systeme: 'surface_m2',
  isolant_pse: 'surface_m2',
  soubassement: 'soubassement_m2',
  menuiserie: 'menuiserie_m2',
  dessous_toit: 'dessous_toit_ml',
  appuis: 'appuis_ml',
  tableaux: 'tableaux_ml',
  couvertine: 'couvertine_ml',
  volet: 'nb_volets',
  report_eclairage: 'nb_report_eclairage',
  report_robinet: 'nb_report_robinet',
  report: 'nb_report',
  descente_ep: 'nb_descente_ep',
  fixation: 'nb_fixation',
}

// ---------- Extraction des métrés depuis la dictée (Claude) ----------

const MODELE_CLAUDE = 'claude-sonnet-4-20250514'

function buildPromptMetres(dictee: string): string {
  return `Tu extrais les MÉTRÉS d'une dictée de chantier de façade (ravalement OU isolation thermique par l'extérieur), dictée par le pro sur le terrain. Tu ne rédiges rien, tu ne devines aucune quantité non dite : tu structures uniquement ce qui est énoncé.

DICTÉE :
---
${dictee}
---

Réponds STRICTEMENT en JSON valide (sans markdown, sans texte autour), schéma exact :
{
  "facades": [
    {
      "nom": "<nom de la façade tel que dicté, ex: Façade Sud, Pignon Est, Façade principale>",
      "surface_m2": <surface du mur principal à traiter/isoler, ou null>,
      "dessous_toit_ml": <ml ou null>,
      "appuis_ml": <ml d'appuis de fenêtres ou null>,
      "tableaux_ml": <ml de tableaux de fenêtres isolés (ITE) ou null>,
      "soubassement_m2": <m² de soubassement ou null>,
      "menuiserie_m2": <m² de menuiseries/contours métal peints ou null>,
      "couvertine_ml": <ml de couvertine ou null>,
      "nb_volets": <nombre de jeux de volets battants ou null>,
      "nb_report_eclairage": <nombre de reports d'éclairage ou null>,
      "nb_report_robinet": <nombre de reports de robinet ou null>,
      "nb_descente_ep": <nombre de descentes EP à modifier ou null>,
      "nb_fixation": <nombre de fixations (arrêts volet, descente EP) ou null>
    }
  ],
  "transversal": { "echafaudage_m2": <nombre ou null>, "lavage_m2": <nombre ou null>, "traitement_m2": <nombre ou null> },
  "points_singuliers": [
    { "type": "souche|corniche|chevron|portail|autre", "libelle": "<ce qui est dit>", "quantite": <nombre>, "unite": "m²|ml|u|m³" }
  ]
}

RÈGLES :
- Une entrée "facades" par façade nommée. Toute mesure non dictée pour une façade = null. N'invente aucun chiffre.
- "surface_m2" = la surface du mur (ravalement ou ITE). En ITE, l'isolant et le système couvrent cette même surface.
- CHAQUE poste a SA PROPRE quantité, même si plusieurs sont cités dans la même phrase. N'utilise jamais un compteur global appliqué à plusieurs postes. Exemple : « un report d'éclairage et un report de robinet » => nb_report_eclairage:1 ET nb_report_robinet:1 (surtout PAS 2 partout). « deux volets et une descente EP » => nb_volets:2 ET nb_descente_ep:1. Lis la portion de phrase propre à chaque poste.
- "transversal" : remplis échafaudage/lavage/traitement UNIQUEMENT si un total global est dicté ; sinon null (un total = somme des surfaces de façade sera calculé en aval).
- "points_singuliers" : RÉSERVÉ aux postes ponctuels qui ne sont PAS déjà des mesures de façade ci-dessus (souche de cheminée, corniche, tête de chevron, portail...). NE mets PAS ici les appuis, tableaux, dessous de toit, soubassement, volets (ils vont dans la façade), NI l'échafaudage, le lavage, le traitement, les déchets/benne, le déplacement (postes transversaux gérés ailleurs). Choisis le "type" le plus proche, sinon "autre".
- Aucune façade ou poste non mentionné ne doit apparaître.`
}

export async function extraireMetres(dictee: string): Promise<MetresDevis> {
  const reponse = await anthropic.messages.create({
    model: MODELE_CLAUDE,
    max_tokens: 2000,
    messages: [{ role: 'user', content: buildPromptMetres(dictee) }],
  })
  const texte =
    reponse.content[0]?.type === 'text' ? reponse.content[0].text : ''
  const match = texte.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Aucun JSON de métrés dans la réponse Claude.')
  const parsed = JSON.parse(match[0]) as MetresDevis

  // Défaut : si un total transversal n'est pas dicté, on prend la somme des
  // surfaces de façade (échafaudage / lavage / traitement couvrent la surface).
  const sommeSurfaces = (parsed.facades ?? []).reduce(
    (s, f) => s + (f.surface_m2 ?? 0),
    0,
  )
  const t = parsed.transversal ?? {}
  return {
    facades: parsed.facades ?? [],
    transversal: {
      echafaudage_m2: (t.echafaudage_m2 ?? sommeSurfaces) || null,
      lavage_m2: (t.lavage_m2 ?? sommeSurfaces) || null,
      traitement_m2: (t.traitement_m2 ?? sommeSurfaces) || null,
    },
    points_singuliers: parsed.points_singuliers ?? [],
  }
}

// ---------- Reconstruction de l'arbre ----------

const ordonner = (lignes: LigneModele[] | undefined): LigneModele[] =>
  [...(lignes ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

// Assemble les enfants d'un groupe en appliquant un résolveur de quantité.
// Une ligne produit dont la quantité résolue est nulle/≤0 est ABANDONNÉE, et
// le titre texte qui la précède immédiatement l'est aussi (pas de titre
// orphelin). Le titre courant (dernier texte vu) est passé au résolveur : il
// porte le contexte que le produit seul ne donne pas (ex : « partie non
// chauffée » en ITE, où le libellé produit est identique à la partie chauffée).
function assemblerEnfants(
  enfants: LigneModele[],
  resoudreQuantite: (l: LigneModele, titreCourant: string) => number | null,
): LignePayload[] {
  const out: LignePayload[] = []
  let textesEnAttente: LignePayload[] = []
  let titreCourant = ''
  for (const l of ordonner(enfants)) {
    if (l.type === 'text') {
      textesEnAttente.push({ type: 'text', description: l.description ?? '' })
      titreCourant = l.description ?? ''
    } else if (l.type === 'group') {
      out.push(...textesEnAttente)
      textesEnAttente = []
      out.push({
        type: 'group',
        description: l.description ?? '',
        lines: assemblerEnfants(l.lines ?? [], resoudreQuantite),
      })
    } else if (l.type === 'product') {
      const q = resoudreQuantite(l, titreCourant)
      if (q != null && q > 0 && l.product?.id) {
        out.push(...textesEnAttente)
        out.push({
          type: 'product',
          product: l.product.id,
          description: l.description ?? '',
          quantity: q,
          sellPrice: l.sellPrice ?? 0,
          unit: l.unit?.id ?? uniteVersCostructorId(l.unit?.symbol ?? ''),
        })
      }
      // produit abandonné → on jette aussi son titre en attente
      textesEnAttente = []
    }
  }
  out.push(...textesEnAttente) // textes de fin sans produit (rare)
  return out
}

// Classe un groupe racine du modèle.
function classifierGroupe(
  g: LigneModele,
): 'entete' | 'facade' | 'eco' | 'autre' {
  const roles: RoleProduit[] = []
  const collecter = (lignes: LigneModele[] | undefined) => {
    for (const l of lignes ?? []) {
      if (l.type === 'product') roles.push(roleProduit(l.description))
      if (l.type === 'group') collecter(l.lines)
    }
  }
  collecter(g.lines)
  // Façade = groupe portant un mur au m² (ravalement OU système ITE).
  if (roles.includes('ravalement') || roles.includes('ite_systeme')) return 'facade'
  if (roles.includes('eco') || /eco-?contribution/i.test(g.description ?? ''))
    return 'eco'
  if (roles.some((r) => ['echafaudage', 'lavage', 'traitement'].includes(r)))
    return 'entete'
  return 'autre'
}

// Résolveur de quantité pour le bloc transversal (en-tête).
function quantiteTransversale(l: LigneModele, m: MetresTransversal): number | null {
  switch (roleProduit(l.description)) {
    case 'echafaudage':
      return m.echafaudage_m2 ?? null
    case 'lavage':
      return m.lavage_m2 ?? null
    case 'traitement':
      return m.traitement_m2 ?? null
    default:
      return l.quantity ?? 1 // autre poste transversal : on garde la qté modèle
  }
}

// Résolveur de quantité pour une façade donnée. Le rôle du produit pointe vers
// une mesure de façade (table MESURE_FACADE). Si la mesure n'est pas dictée, la
// ligne est ABANDONNÉE (et son titre, cf. assemblerEnfants) : on n'invente pas
// de quantité et on ne garde pas de ligne à 1 dans une façade.
function quantiteFacade(
  l: LigneModele,
  f: MetresFacade,
  titreCourant: string,
): number | null {
  const role = roleProduit(l.description)
  // Forfaits éventuellement présents dans une façade : on garde la qté modèle.
  if (role === 'deplacement' || role === 'dechets' || role === 'eco')
    return l.quantity ?? 1
  // ITE : la partie « non chauffée » duplique le système au m² (même libellé
  // produit que la partie chauffée). La surface dictée = partie chauffée ; on
  // abandonne la partie non chauffée pour ne pas doubler la surface isolée.
  if (
    (role === 'ite_systeme' || role === 'isolant_pse') &&
    /non chauffee/.test(
      titreCourant
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, ''),
    )
  )
    return null
  const cle = MESURE_FACADE[role]
  if (!cle) return null // rôle non piloté (accessoire : rail, profil...) → abandon
  const v = f[cle]
  return typeof v === 'number' ? v : null
}

// Cherche dans la liste plate le produit correspondant à un point singulier.
const MOTS_CLES_POINT: Record<string, string[]> = {
  souche: ['souche'],
  corniche: ['corniche'],
  descente_ep: ['descente'],
  tableaux: ['tableau'],
  chevron: ['chevron'],
  portail: ['portail'],
  fixation: ['fixation'],
}

// Rôles qui ne sont JAMAIS des points singuliers : ils sont déjà portés par le
// bloc transversal, les forfaits ou les groupes dédiés du modèle. Empêche un
// « benne pour les déchets » dicté de se dédoubler avec le groupe Déchets.
const ROLES_EXCLUS_POINT = new Set<RoleProduit>([
  'echafaudage',
  'lavage',
  'traitement',
  'dechets',
  'eco',
  'deplacement',
  'ravalement',
  'ite_systeme',
  'isolant_pse',
])

export function chercherProduitPoint(
  produits: ProduitPlat[],
  point: PointSingulier,
): ProduitPlat | null {
  const motsCles =
    MOTS_CLES_POINT[point.type] ??
    normaliser(point.libelle)
      .split(' ')
      .filter((w) => w.length > 3)
  if (motsCles.length === 0) return null
  let meilleur: { p: ProduitPlat; score: number } | null = null
  for (const p of produits) {
    if (ROLES_EXCLUS_POINT.has(roleProduit(p.name))) continue // pas un point singulier
    const nom = normaliser(p.name)
    const score = motsCles.filter((m) => nom.includes(normaliser(m))).length
    if (score > 0 && (!meilleur || score > meilleur.score)) {
      meilleur = { p, score }
    }
  }
  return meilleur?.p ?? null
}

function unitIdProduit(p: ProduitPlat, uniteFallback: string): string {
  if (p.unit && typeof p.unit === 'object' && 'id' in p.unit) return p.unit.id
  if (typeof p.unit === 'string') return p.unit
  return uniteVersCostructorId(uniteFallback)
}

// Construit le groupe "Points singuliers" (ou null si aucun trouvé).
// Les points non résolus sont signalés (jamais ajoutés en silence).
function construireGroupePoints(
  points: PointSingulier[],
  produits: ProduitPlat[],
): { groupe: LignePayload | null; nonResolus: PointSingulier[] } {
  const lines: LignePayload[] = []
  const nonResolus: PointSingulier[] = []
  for (const pt of points) {
    if (!pt.quantite || pt.quantite <= 0) {
      nonResolus.push(pt)
      continue
    }
    const prod = chercherProduitPoint(produits, pt)
    if (!prod) {
      nonResolus.push(pt)
      continue
    }
    lines.push({
      type: 'product',
      product: prod.id,
      description: (prod.name ?? '').replace(/<[^>]+>/g, '').trim(),
      quantity: pt.quantite,
      sellPrice: prod.sellPrice ?? 0,
      unit: unitIdProduit(prod, pt.unite),
    })
  }
  if (lines.length === 0) return { groupe: null, nonResolus }
  return {
    groupe: { type: 'group', description: 'Points singuliers', lines },
    nonResolus,
  }
}

export interface PayloadConstruit {
  lines: LignePayload[]
  nonResolus: PointSingulier[]
  totalAttenduCentimes: number
}

// Reproduit l'arbre du modèle, instancie une façade par façade dictée, remplit
// les métrés, insère les points singuliers, conserve en-tête et éco-contribution.
export function construirePayloadDepuisModele(
  modeleLines: LigneModele[],
  metres: MetresDevis,
  produits: ProduitPlat[],
): PayloadConstruit {
  const out: LignePayload[] = []
  let facadesEmises = false
  let nonResolus: PointSingulier[] = []

  for (const ligne of ordonner(modeleLines)) {
    if (ligne.type === 'text') {
      out.push({ type: 'text', description: ligne.description ?? '' })
      continue
    }
    if (ligne.type === 'product') {
      // produit isolé au niveau racine (rare) : on garde sa qté modèle
      if (ligne.product?.id) {
        out.push({
          type: 'product',
          product: ligne.product.id,
          description: ligne.description ?? '',
          quantity: ligne.quantity ?? 1,
          sellPrice: ligne.sellPrice ?? 0,
          unit: ligne.unit?.id ?? uniteVersCostructorId(ligne.unit?.symbol ?? ''),
        })
      }
      continue
    }

    // ligne.type === 'group'
    const classe = classifierGroupe(ligne)
    if (classe === 'facade') {
      if (!facadesEmises) {
        // Instancie le motif de façade du modèle, une fois par façade dictée.
        for (const f of metres.facades) {
          out.push({
            type: 'group',
            description: f.nom,
            lines: assemblerEnfants(ligne.lines ?? [], (l, titre) =>
              quantiteFacade(l, f, titre),
            ),
          })
        }
        // Points singuliers juste après les façades.
        const { groupe, nonResolus: nr } = construireGroupePoints(
          metres.points_singuliers,
          produits,
        )
        if (groupe) out.push(groupe)
        nonResolus = nr
        facadesEmises = true
      }
      // les groupes façade suivants du modèle sont des doublons → ignorés
    } else if (classe === 'entete') {
      out.push({
        type: 'group',
        description: ligne.description ?? '',
        lines: assemblerEnfants(ligne.lines ?? [], (l) =>
          quantiteTransversale(l, metres.transversal),
        ),
      })
    } else {
      // eco / autre : reproduit tel quel (quantités modèle conservées)
      out.push({
        type: 'group',
        description: ligne.description ?? '',
        lines: assemblerEnfants(ligne.lines ?? [], (l) => l.quantity ?? 1),
      })
    }
  }

  const totalAttenduCentimes = sommeProduits(out)
  return { lines: out, nonResolus, totalAttenduCentimes }
}

// Somme quantity × sellPrice sur TOUTES les lignes produit (récursion dans les
// groupes du PAYLOAD qu'on construit nous-mêmes — pas la vue redondante d'un GET).
export function sommeProduits(lines: LignePayload[]): number {
  let total = 0
  for (const l of lines) {
    // Costructor arrondit le sous-total de CHAQUE ligne au centime entier
    // (qté fractionnaire possible, ex : 0,3 m³ de benne). On reproduit cet
    // arrondi par ligne pour que le total attendu colle au subtotal renvoyé.
    if (l.type === 'product') total += Math.round(l.quantity * l.sellPrice)
    else if (l.type === 'group') total += sommeProduits(l.lines)
  }
  return total
}

// ---------- Push BROUILLON (écriture compte test UNIQUEMENT) ----------

export async function pousserDevisGroupe(payload: {
  customer: string
  description: string
  lines: LignePayload[]
  chantierId?: string | null // si fourni, on injecte le lien du compte rendu
}): Promise<any> {
  const key = assertCompteJulien() // refuse la clé d'Olivier
  // Etape 2 (Phase G) : au moment du push, on enrichit la description avec le
  // lien du PDF de compte rendu du chantier (workaround R2). Si aucun PDF n'a été
  // persisté, la description reste inchangée (pas de lien cassé).
  const { customer, lines, chantierId } = payload
  const description = await composerDescriptionAvecRapport(
    payload.description,
    chantierId,
  )
  const r = await fetch(`${BASE_URL}/quotes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    // On n'envoie QUE les champs connus de Costructor (pas de chantierId).
    // Pas de status → BROUILLON par défaut.
    body: JSON.stringify({ customer, description, lines }),
  })
  if (!r.ok) throw new Error(`POST /quotes ${r.status} : ${await r.text()}`)
  const j = (await r.json()) as { data?: any } & any
  return j.data !== undefined ? j.data : j
}
