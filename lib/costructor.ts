// =============================================================
// SDK Costructor maison — fetch + Bearer
// =============================================================
// Endpoints réels validés par l'audit :
//   /contacts  pour les clients
//   /products  pour la bibliothèque d'articles
//   /quotes    pour les devis
//
// Format des montants : ENTIERS EN CENTIMES (4500 = 45,00 €)
// Réponses : { data: {...|[...]}, metadata: {...} }
// Auth : Authorization: Bearer <COSTRUCTOR_API_KEY>

import type {
  CostructorProduct,
  CostructorQuotePayload,
  CostructorQuoteResponse,
  SectionDevis,
} from './types'

const BASE_URL =
  process.env.COSTRUCTOR_API_BASE_URL || 'https://api.costructor.co/external/v1'
const API_KEY = process.env.COSTRUCTOR_API_KEY

// ---------- Constantes critiques (IDs Costructor compte démo Olivier) ----------
// Validés visuellement par l'audit.
export const UNIT_M2 = 'unit_01fvj2wadbh7qc1784z1es0nke'
export const UNIT_ML = 'unit_01fvj2wafhw41w7hpaeb3ywfg5'
export const UNIT_FORFAIT = 'unit_01fvj2wadbh7qc1784z1es0nke' // pas d'unité forfait → fallback m²

// TVA 10% travaux.
export const TAX_TVA_10 = 'tx_01kgkxxt0paj8rpp7va415yxyy'

// Mapping unité affichée → ID Costructor.
export function uniteVersCostructorId(unite: string): string {
  const u = unite.toLowerCase().trim()
  if (u === 'm²' || u === 'm2') return UNIT_M2
  if (u === 'ml') return UNIT_ML
  return UNIT_FORFAIT
}

// Strip HTML wrappers retournés par l'API (`<div>...</div>`).
export function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim()
}

// € → centimes (l'API attend des entiers).
export function eurosVersCentimes(euros: number): number {
  return Math.round(euros * 100)
}

// ---------- Wrapper fetch ----------

async function costructorFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!API_KEY) {
    throw new Error('COSTRUCTOR_API_KEY manquante dans .env.local')
  }
  const url = `${BASE_URL}${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
    Accept: 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(url, { ...init, headers })
  if (!res.ok) {
    const corps = await res.text()
    throw new Error(`Costructor ${res.status} sur ${path} : ${corps}`)
  }
  const json = (await res.json()) as { data?: T } & T
  return json.data !== undefined ? (json.data as T) : (json as T)
}

// ---------- Produits ----------

export async function listerProduits(): Promise<CostructorProduct[]> {
  const items = await costructorFetch<CostructorProduct[]>('/products')
  return items.map((p) => ({
    ...p,
    name: stripHtml(p.name ?? ''),
  }))
}

// ---------- Contacts ----------

export async function creerContactParticulier(input: {
  firstName: string
  lastName: string
  street?: string
  city?: string
  zip?: string
  country?: string
}): Promise<{ id: string }> {
  return costructorFetch<{ id: string }>('/contacts', {
    method: 'POST',
    body: JSON.stringify({
      type: 'client',
      legalStatus: 'individual',
      firstName: input.firstName,
      lastName: input.lastName,
      address: {
        street: input.street ?? '',
        city: input.city ?? '',
        zip: input.zip ?? '',
        country: input.country ?? 'FR',
      },
    }),
  })
}

// ---------- Devis ----------

export async function pousserDevis(
  payload: CostructorQuotePayload,
): Promise<CostructorQuoteResponse> {
  return costructorFetch<CostructorQuoteResponse>('/quotes', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// Supprime un brouillon Costructor (utilisé pour éviter les doublons lors d'un re-push).
// Tolère l'échec (déjà supprimé, ID périmé) pour ne pas bloquer le re-push.
export async function supprimerDevis(quoteId: string): Promise<void> {
  if (!API_KEY) throw new Error('COSTRUCTOR_API_KEY manquante')
  try {
    await fetch(`${BASE_URL}/quotes/${quoteId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        Accept: 'application/json',
      },
    })
  } catch {
    // Ignore les erreurs : on veut juste tenter le nettoyage.
  }
}

// =============================================================
// Helpers de construction du payload devis depuis sections_finales
// =============================================================

// Total HT en euros (depuis sections finales).
export function calculerTotalHT(sections: SectionDevis[]): number {
  let total = 0
  for (const section of sections) {
    for (const article of section.articles) {
      if (article.quantite != null) {
        total += article.quantite * article.prix_vente
      }
    }
  }
  return Math.round(total * 100) / 100
}

// Total TTC (TVA 10%).
export function calculerTotalTTC(totalHT: number): number {
  return Math.round(totalHT * 1.1 * 100) / 100
}

// Construit le payload Costructor.
// `sections[].articles[].prix_vente` est en euros (DB), converti en centimes ici.
export function construirePayloadDevis(args: {
  contactId: string
  sections: SectionDevis[]
  description: string
}): CostructorQuotePayload {
  const lines: CostructorQuotePayload['lines'] = []

  for (const section of args.sections) {
    // Séparateur de section : type "text" (PAS "section" qui crée des placeholders parasites).
    lines.push({ type: 'text', description: section.nom })

    for (const article of section.articles) {
      if (article.quantite == null || article.quantite <= 0) continue
      // Description Costructor : libellé en titre HTML + description technique en dessous.
      // L'éditeur Costructor préserve les balises HTML ; les sauts \n bruts sont
      // strippés à l'affichage. On utilise <strong> + <br><br> pour forcer le
      // rendu visuel d'un titre suivi de paragraphes lisibles.
      const desc = article.description_technique?.trim()
      let fullDescription: string
      if (desc && desc !== article.libelle) {
        // Convertit les sauts \n\n du paragraphes en <br><br> HTML.
        const descHtml = desc
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean)
          .join('<br><br>')
        fullDescription = `<strong>${article.libelle}</strong><br><br>${descHtml}`
      } else {
        fullDescription = `<strong>${article.libelle}</strong>`
      }
      lines.push({
        type: 'product',
        product: article.costructor_article_id,
        description: fullDescription,
        quantity: article.quantite,
        sellPrice: eurosVersCentimes(article.prix_vente),
        unit: uniteVersCostructorId(article.unite),
      })
    }
  }

  return {
    customer: args.contactId,
    description: args.description,
    lines,
  }
}
