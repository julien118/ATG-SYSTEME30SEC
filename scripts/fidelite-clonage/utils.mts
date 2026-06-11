// Utilitaires partages de la suite de fidelite du moteur de clonage ITE.
// Aucune ecriture ici : que des helpers (normalisation, aplatissement d'arbre,
// modele fabrique pour le test hors-ligne, type de resultat).

import type { LigneModele } from '../../lib/atg-devis-modele'

export type Statut = 'PASS' | 'FAIL' | 'SKIP'
export interface Resultat {
  nom: string
  statut: Statut
  details?: string
}

export function ok(nom: string, details?: string): Resultat {
  return { nom, statut: 'PASS', details }
}
export function ko(nom: string, details?: string): Resultat {
  return { nom, statut: 'FAIL', details }
}
export function skip(nom: string, details?: string): Resultat {
  return { nom, statut: 'SKIP', details }
}

// Normalisation texte : retire HTML, accents, casse, espaces multiples.
export function norm(s: any): string {
  return String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Aplatit un arbre Costructor (relu ou payload) en listes ordonnees.
export interface ArbrePlat {
  groupes: string[]
  textes: string[]
  produits: Array<{
    pid: string
    desc: string
    quantity: number
    subtotal: number
    sellPrice: number
    unit: string
    taxId: string | null
    taxRate: number | null
  }>
}
export function aplatir(lines: any[]): ArbrePlat {
  const r: ArbrePlat = { groupes: [], textes: [], produits: [] }
  const walk = (ls: any[]) => {
    for (const l of [...(ls ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
      if (l.type === 'group') {
        r.groupes.push(norm(l.description))
        walk(l.lines)
      } else if (l.type === 'text') {
        r.textes.push(norm(l.description))
      } else if (l.type === 'product') {
        // `product` : chaine (format PAYLOAD) ou objet {id} (format RELU).
        const pid = typeof l.product === 'string' ? l.product : l.product?.id ?? ''
        // `tax` : chaine (PAYLOAD) ou objet {id, rate} (RELU).
        const taxId = typeof l.tax === 'string' ? l.tax : l.tax?.id ?? null
        const taxRate = typeof l.tax === 'object' && l.tax ? l.tax.rate ?? null : l.taxRate ?? null
        r.produits.push({
          pid,
          desc: norm(l.description || (typeof l.product === 'object' ? l.product?.name : '')),
          quantity: l.quantity ?? 0,
          subtotal: l.subtotal ?? 0,
          sellPrice: l.sellPrice ?? 0,
          unit: typeof l.unit === 'object' ? l.unit?.symbol ?? '' : '',
          taxId,
          taxRate,
        })
      }
    }
  }
  walk(lines)
  return r
}

// Retente une operation en cas de 429 (rate-limit Costructor) avec backoff. La
// suite enchaine beaucoup d'appels ; un 429 transitoire ne doit pas faire echouer
// un test de logique. Ne retente QUE sur 429 ; toute autre erreur remonte direct.
export async function reessayer429<T>(fn: () => Promise<T>, essais = 4): Promise<T> {
  let derniere: unknown
  for (let i = 0; i < essais; i++) {
    try {
      return await fn()
    } catch (e) {
      derniere = e
      if (!String((e as Error).message ?? '').includes('429')) throw e
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
    }
  }
  throw derniere
}

// Compte les occurrences d'un product.id dans un arbre aplati.
export function occ(arbre: ArbrePlat, pid: string): number {
  return arbre.produits.filter((p) => p.pid === pid).length
}
export function qtes(arbre: ArbrePlat, pid: string): number[] {
  return arbre.produits.filter((p) => p.pid === pid).map((p) => p.quantity)
}

// ---------- Modele FABRIQUE (test hors-ligne A2) ----------
// Petit modele representatif : en-tete texte (squelette), groupe transversal
// (echafaudage = metre), groupe facade avec sous-titres et un poste repete
// (partie chauffee / non chauffee, meme product.id), un forfait dechets et un
// forfait eco-contribution (quantite fixe). Permet de tester la reconstruction
// SANS reseau : refs, sous-titres (option b), forfaits pre-remplis, edits, totaux.
const M2 = { id: 'unit_m2', symbol: 'm²' }
const ML = { id: 'unit_ml', symbol: 'ml' }
const U = { id: 'unit_u', symbol: 'u' }
const TX10 = { id: 'tx_10', rate: 1000 }
const TX55 = { id: 'tx_55', rate: 550 }

export const MODELE_FABRIQUE: LigneModele[] = [
  { type: 'text', position: 0, description: 'QUALIFICATIONS ATG - Qualibat 6111' },
  {
    type: 'group', position: 1, description: 'Installation',
    lines: [
      { type: 'product', position: 0, description: 'Echafaudage Comabi R200', sellPrice: 1000, quantity: 1, tax: TX10, unit: M2, product: { id: 'prod_ech', name: 'echafaudage' } },
    ],
  },
  {
    type: 'group', position: 2, description: 'Façade',
    lines: [
      { type: 'text', position: 0, description: 'Partie chauffée' },
      { type: 'product', position: 1, description: 'Isolation thermique exterieur StarSystem', sellPrice: 13000, quantity: 1, tax: TX55, unit: M2, product: { id: 'prod_ite', name: 'ITE' } },
      { type: 'product', position: 2, description: 'Panneau PSE 140', sellPrice: 5000, quantity: 1, tax: TX55, unit: M2, product: { id: 'prod_pse', name: 'PSE' } },
      { type: 'text', position: 3, description: 'Partie non chauffée' },
      { type: 'product', position: 4, description: 'Isolation thermique exterieur StarSystem', sellPrice: 13000, quantity: 1, tax: TX55, unit: M2, product: { id: 'prod_ite', name: 'ITE' } },
      { type: 'product', position: 5, description: 'Dessous de toit', sellPrice: 2000, quantity: 1, tax: TX10, unit: ML, product: { id: 'prod_dst', name: 'dessous de toit' } },
    ],
  },
  {
    type: 'group', position: 3, description: 'Déchets',
    lines: [
      { type: 'product', position: 0, description: 'Gestion des dechets benne DIB', sellPrice: 30000, quantity: 1, tax: TX10, unit: U, product: { id: 'prod_benne', name: 'benne' } },
    ],
  },
  {
    type: 'group', position: 4, description: 'Éco-contribution',
    lines: [
      { type: 'product', position: 0, description: 'Eco-contribution DEEE', sellPrice: 500, quantity: 1, tax: TX10, unit: U, product: { id: 'prod_eco', name: 'eco' } },
    ],
  },
]
