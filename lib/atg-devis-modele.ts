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

const BASE_URL =
  process.env.COSTRUCTOR_API_BASE_URL || 'https://api.costructor.co/external/v1'

// ---------- Garde-fous de compte (RÈGLE 1) ----------

// Renvoie la clé d'écriture (Julien) APRÈS avoir vérifié que ce n'est PAS celle
// d'Olivier. Toute fonction qui écrit DOIT passer par là.
export function assertCompteJulien(): string {
  const key = process.env.COSTRUCTOR_API_KEY
  const keyOlivier = process.env.COSTRUCTOR_API_KEY_OLIVIER
  if (!key) throw new Error('COSTRUCTOR_API_KEY (compte test Julien) manquante.')
  if (keyOlivier && key === keyOlivier) {
    throw new Error(
      'STOP (RÈGLE 1) : la clé d\'écriture est celle d\'OLIVIER. Aucune écriture autorisée sur son compte.',
    )
  }
  return key
}

export function bannerCompte(action: 'LECTURE' | 'ÉCRITURE'): void {
  const key = process.env.COSTRUCTOR_API_KEY
  console.log('=============================================================')
  console.log(`COSTRUCTOR — ${action} sur le compte JULIEN (test)`)
  console.log(`  clé ...${key ? key.slice(-6) : '(absente)'}`)
  console.log('=============================================================')
}

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
  surface_m2?: number | null
  dessous_toit_ml?: number | null
  appuis_ml?: number | null
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
  | 'dessous_toit'
  | 'appuis'
  | 'ravalement'
  | 'eco'
  | 'autre'

export function roleProduit(description: string | null | undefined): RoleProduit {
  const d = normaliser(description)
  if (/echafaudage|comabi|amene du materiel/.test(d)) return 'echafaudage'
  if (/lavage/.test(d)) return 'lavage'
  if (/algicide|fongicide/.test(d)) return 'traitement'
  if (/dessous de toit/.test(d)) return 'dessous_toit'
  if (/appuis/.test(d)) return 'appuis'
  if (/ravalement i3 peinture|i3 peinture|virtuotech/.test(d)) return 'ravalement'
  if (/eco-?contribution/.test(d)) return 'eco'
  return 'autre'
}

// ---------- Extraction des métrés depuis la dictée (Claude) ----------

const MODELE_CLAUDE = 'claude-sonnet-4-20250514'

function buildPromptMetres(dictee: string): string {
  return `Tu extrais les MÉTRÉS d'une dictée de chantier de ravalement, dictée par le pro sur le terrain. Tu ne rédiges rien, tu ne devines aucune quantité non dite : tu structures uniquement ce qui est énoncé.

DICTÉE :
---
${dictee}
---

Réponds STRICTEMENT en JSON valide (sans markdown, sans texte autour), schéma exact :
{
  "facades": [
    { "nom": "<nom de la façade tel que dicté, ex: Façade Sud, Pignon Est>", "surface_m2": <nombre ou null>, "dessous_toit_ml": <nombre ou null>, "appuis_ml": <nombre ou null> }
  ],
  "transversal": { "echafaudage_m2": <nombre ou null>, "lavage_m2": <nombre ou null>, "traitement_m2": <nombre ou null> },
  "points_singuliers": [
    { "type": "souche|corniche|descente_ep|tableaux|chevron|portail|fixation|autre", "libelle": "<ce qui est dit>", "quantite": <nombre>, "unite": "m²|ml|u|m³" }
  ]
}

RÈGLES :
- Une entrée "facades" par façade nommée. Si une mesure (surface, dessous de toit, appuis) n'est pas dictée pour cette façade, mets null. N'invente aucun chiffre.
- "transversal" : ne remplis échafaudage/lavage/traitement QUE si un total global est dicté ; sinon null (un total sera calculé en aval comme la somme des surfaces de façade).
- "points_singuliers" : seulement les postes ponctuels explicitement dictés (souche de cheminée, corniche, descente d'eau pluviale, tableaux/voussures, tête de chevron, portail, fixations...). Choisis le "type" le plus proche, sinon "autre". Reporte la quantité et l'unité dictées.
- Aucune façade ou point non mentionné ne doit apparaître.`
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
// le titre texte qui la précède immédiatement l'est aussi (pas de titre orphelin).
function assemblerEnfants(
  enfants: LigneModele[],
  resoudreQuantite: (l: LigneModele) => number | null,
): LignePayload[] {
  const out: LignePayload[] = []
  let textesEnAttente: LignePayload[] = []
  for (const l of ordonner(enfants)) {
    if (l.type === 'text') {
      textesEnAttente.push({ type: 'text', description: l.description ?? '' })
    } else if (l.type === 'group') {
      out.push(...textesEnAttente)
      textesEnAttente = []
      out.push({
        type: 'group',
        description: l.description ?? '',
        lines: assemblerEnfants(l.lines ?? [], resoudreQuantite),
      })
    } else if (l.type === 'product') {
      const q = resoudreQuantite(l)
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
  if (roles.includes('ravalement')) return 'facade'
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

// Résolveur de quantité pour une façade donnée.
function quantiteFacade(l: LigneModele, f: MetresFacade): number | null {
  switch (roleProduit(l.description)) {
    case 'ravalement':
      return f.surface_m2 ?? null
    case 'dessous_toit':
      return f.dessous_toit_ml ?? null
    case 'appuis':
      return f.appuis_ml ?? null
    default:
      return l.quantity ?? 1
  }
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
            lines: assemblerEnfants(ligne.lines ?? [], (l) => quantiteFacade(l, f)),
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
    if (l.type === 'product') total += l.quantity * l.sellPrice
    else if (l.type === 'group') total += sommeProduits(l.lines)
  }
  return total
}

// ---------- Push BROUILLON (écriture compte test UNIQUEMENT) ----------

export async function pousserDevisGroupe(payload: {
  customer: string
  description: string
  lines: LignePayload[]
}): Promise<any> {
  const key = assertCompteJulien() // refuse la clé d'Olivier
  const r = await fetch(`${BASE_URL}/quotes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload), // pas de status → BROUILLON par défaut
  })
  if (!r.ok) throw new Error(`POST /quotes ${r.status} : ${await r.text()}`)
  const j = (await r.json()) as { data?: any } & any
  return j.data !== undefined ? j.data : j
}
