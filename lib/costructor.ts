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

import {
  STRUCTURE_DEVIS_ATG,
  trouverSectionTransversale,
} from './atg-devis-structure'
import { assertCompteJulien, bannerCompte } from './costructor-compte'
import type {
  CostructorContact,
  CostructorProduct,
  CostructorQuotePayload,
  CostructorQuoteResponse,
  ResultatRechercheContact,
  SectionDevis,
} from './types'

const BASE_URL =
  process.env.COSTRUCTOR_API_BASE_URL || 'https://api.costructor.co/external/v1'
const API_KEY = process.env.COSTRUCTOR_API_KEY

// ---------- Constantes critiques (IDs Costructor compte démo Olivier) ----------
// Validés visuellement par l'audit.
// IDs d'unités Costructor (globaux, valides sur tout compte — vérifiés via GET /units).
export const UNIT_M2 = 'unit_01fvj2wadbh7qc1784z1es0nke' // m²
export const UNIT_ML = 'unit_01fvj2wafhw41w7hpaeb3ywfg5' // ml
export const UNIT_U = 'unit_01fvj2wa9fgmx3th3na873ccws' // u (à la pièce)
export const UNIT_M3 = 'unit_01fvj2wahmvbmnf8y0czmqjjep' // m³
export const UNIT_ENS = 'unit_01fvj2waghdkq11qjba76hk2dt' // ens (ensemble)
export const UNIT_FORFAIT = UNIT_U // un forfait se compte à l'unité (style Olivier)

// TVA 10% travaux.
export const TAX_TVA_10 = 'tx_01kgkxxt0paj8rpp7va415yxyy'

// Mapping unité affichée → ID Costructor. Olivier utilise m², ml, u, m³, ens.
export function uniteVersCostructorId(unite: string): string {
  const u = unite.toLowerCase().trim()
  if (u === 'm²' || u === 'm2') return UNIT_M2
  if (u === 'ml') return UNIT_ML
  if (u === 'm³' || u === 'm3') return UNIT_M3
  if (u === 'u' || u === 'unité' || u === 'unite' || u === 'pièce' || u === 'piece')
    return UNIT_U
  if (u === 'ens' || u === 'ensemble' || u === 'forfait') return UNIT_ENS
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

// L'API Costructor IGNORE silencieusement les query params ?email, ?phone,
// ?search, ?q sur /contacts (testé 2026-05-21). On liste donc tout et on filtre
// en mémoire. À revoir si la base d'Olivier dépasse quelques centaines de
// contacts : il faudra paginer et/ou stocker un index côté Supabase.
//
// PIÈGE #12 : les méta-params Costructor doivent être préfixés `_` sinon ils
// sont ignorés. `?limit=1000` (sans underscore) était silencieusement plafonné à
// 10 → la dédup ne voyait que 10 contacts sur ~300. `?_limit=1000` débloque la
// liste complète.
export async function listerContacts(): Promise<CostructorContact[]> {
  return costructorFetch<CostructorContact[]>('/contacts?_limit=1000')
}

// Normalisations pour le matching.
function normaliserEmail(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

// FR : on garde les 9 derniers chiffres (612345678 sans préfixe pays).
// Tolère "06 12 34 56 78", "+33 6 12...", "0612345678", "06-12-..." → 612345678.
function normaliserTelephone(s: string | null | undefined): string {
  const digits = (s ?? '').replace(/\D/g, '')
  return digits.slice(-9)
}

function normaliserNom(s: string | null | undefined): string {
  return (s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
}

// Best-effort parse d'une adresse française "7 Rue Marie de Luxembourg 41100 Vendôme".
// Extrait le code postal 5 chiffres : avant = rue, après = ville.
export function parseAdresseFr(adresse: string | null | undefined): {
  street: string
  city: string
  zip: string
} {
  const a = (adresse ?? '').trim()
  if (!a) return { street: '', city: '', zip: '' }
  const m = a.match(/^(.+?)\s+(\d{5})\s+(.+)$/)
  if (m) return { street: m[1].trim(), city: m[3].trim(), zip: m[2] }
  return { street: a, city: '', zip: '' }
}

// T2 : assainit un téléphone AVANT envoi à Costructor. L'API rejette les
// numéros avec espaces/séparateurs ("06 12 34 56 78" → 400 phone_number.invalid).
// On ne garde que les chiffres en PRÉSERVANT le 0 de tête (≠ normaliserTelephone
// qui tronque aux 9 derniers chiffres, pour le seul besoin de comparaison).
function assainirTelephonePourEnvoi(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

// T4 : ville + code postal de l'adresse primaire d'un contact (ou la 1re), pour
// servir de second critère de concordance lors du matching par nom.
function villeCpContact(c: CostructorContact): { ville: string; cp: string } {
  const addrs = c.addresses ?? []
  const principale = addrs.find((a) => a.primary) ?? addrs[0]
  const ad = principale?.address ?? null
  return {
    ville: normaliserNom(ad?.city),
    cp: (ad?.postal_code ?? '').replace(/\D/g, ''),
  }
}

export interface RechercheContactInput {
  client_nom: string
  client_email?: string | null
  client_telephone?: string | null
  client_adresse?: string | null
}

// Cherche un contact existant par email > téléphone > nom, sinon le crée.
// Signaux FORTS (fusion automatique) : email exact, téléphone normalisé.
// Signal FAIBLE : le nom. Le champ `client_nom` est en saisie libre et des
// homonymes existent ("M. et Mme Dupont"), donc (T4) la fusion par nom n'est
// autorisée QUE si un second critère concorde aussi (ville OU code postal). Si
// seul le nom correspond, on NE fusionne PAS : on crée un nouveau contact. Un
// doublon évitable vaut mieux qu'une fusion de deux personnes distinctes
// (d'autant que DELETE /contacts = 405, donc une mauvaise fusion est durable).
export async function trouverOuCreerContact(
  input: RechercheContactInput,
): Promise<ResultatRechercheContact> {
  const contacts = await listerContacts()

  const emailNorm = normaliserEmail(input.client_email)
  const phoneNorm = normaliserTelephone(input.client_telephone)
  const nomNorm = normaliserNom(input.client_nom)
  const { street, city, zip } = parseAdresseFr(input.client_adresse)
  const villeNorm = normaliserNom(city)
  const cpNorm = (zip ?? '').replace(/\D/g, '')

  // 1) Email exact (signal fort)
  if (emailNorm) {
    const match = contacts.find((c) => {
      if (normaliserEmail(c.email) === emailNorm) return true
      return (c.emails ?? []).some(
        (e) => normaliserEmail(e.email) === emailNorm,
      )
    })
    if (match) return { contactId: match.id, cree: false, matchType: 'email' }
  }

  // 2) Téléphone normalisé (signal fort)
  if (phoneNorm.length >= 9) {
    const match = contacts.find((c) => {
      if (normaliserTelephone(c.phone) === phoneNorm) return true
      return (c.phones ?? []).some(
        (p) => normaliserTelephone(p.phone) === phoneNorm,
      )
    })
    if (match) return { contactId: match.id, cree: false, matchType: 'phone' }
  }

  // 3) Nom exact + second critère concordant (T4 : signal faible sécurisé).
  // On n'autorise la fusion par nom QUE si la dictée fournit une ville ou un CP
  // ET que ce second critère concorde avec celui du contact candidat. Sans
  // second critère disponible/concordant → pas de fusion → création.
  if (nomNorm && (villeNorm || cpNorm)) {
    const match = contacts.find((c) => {
      const candidats = [
        c.fullName,
        c.companyName,
        c.firstName && c.lastName ? `${c.firstName} ${c.lastName}` : null,
        c.firstName && c.lastName ? `${c.lastName} ${c.firstName}` : null,
      ].filter(Boolean) as string[]
      const nomConcorde = candidats.some((n) => normaliserNom(n) === nomNorm)
      if (!nomConcorde) return false
      const { ville, cp } = villeCpContact(c)
      const cpConcorde = !!cpNorm && !!cp && cp === cpNorm
      const villeConcorde = !!villeNorm && !!ville && ville === villeNorm
      return cpConcorde || villeConcorde
    })
    if (match) return { contactId: match.id, cree: false, matchType: 'nom' }
  }

  // 4) Aucun match → création (écriture : protégée par la RÈGLE 1).
  // On met tout `client_nom` dans lastName et firstName='' : Costructor accepte
  // et fullName devient juste "client_nom" (au lieu d'un split qui produit des
  // noms moches du type "Daquin Résidence Charles" pour les noms de chantier).
  assertCompteJulien() // T3 : refuse la clé d'Olivier avant toute écriture
  bannerCompte('ÉCRITURE')
  const email = input.client_email?.trim()
  // T2 : on assainit le téléphone (chiffres seuls) pour éviter le 400 sur les
  // formats français saisis avec espaces ("06 12 34 56 78").
  const phone = assainirTelephonePourEnvoi(input.client_telephone)

  const body: Record<string, unknown> = {
    type: 'client',
    legalStatus: 'individual',
    firstName: '',
    lastName: input.client_nom.trim(),
  }
  if (street || city || zip) {
    body.addresses = [
      {
        address: { street, city, postal_code: zip, country: 'FR' },
        primary: true,
      },
    ]
  }
  if (email) body.emails = [{ email, primary: true }]
  if (phone) body.phones = [{ phone, primary: true }]

  const created = await costructorFetch<{ id: string }>('/contacts', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return { contactId: created.id, cree: true, matchType: 'created' }
}

// ---------- Devis ----------

export async function pousserDevis(
  payload: CostructorQuotePayload,
): Promise<CostructorQuoteResponse> {
  assertCompteJulien() // T3 / RÈGLE 1 : refuse la clé d'Olivier avant écriture
  bannerCompte('ÉCRITURE')
  return costructorFetch<CostructorQuoteResponse>('/quotes', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// Supprime un brouillon Costructor (utilisé pour éviter les doublons lors d'un re-push).
// Tolère l'échec (déjà supprimé, ID périmé) pour ne pas bloquer le re-push.
export async function supprimerDevis(quoteId: string): Promise<void> {
  assertCompteJulien() // T3 / RÈGLE 1 : DELETE est une écriture
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

// Construit la ligne `product` Costructor à partir d'un article du devis.
// Extrait dans une fonction parce que ce même article peut être émis depuis
// une section transversale ou depuis une section façade.
function ligneProduit(
  article: SectionDevis['articles'][number],
): CostructorQuotePayload['lines'][number] {
  // Description Costructor : libellé en titre HTML + description technique en dessous.
  // L'éditeur Costructor préserve les balises HTML ; les sauts \n bruts sont
  // strippés à l'affichage. On utilise <strong> + <br><br> pour forcer le
  // rendu visuel d'un titre suivi de paragraphes lisibles.
  const desc = article.description_technique?.trim()
  let fullDescription: string
  if (desc && desc !== article.libelle) {
    const descHtml = desc
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .join('<br><br>')
    fullDescription = `<strong>${article.libelle}</strong><br><br>${descHtml}`
  } else {
    fullDescription = `<strong>${article.libelle}</strong>`
  }
  return {
    type: 'product',
    product: article.costructor_article_id,
    description: fullDescription,
    quantity: article.quantite as number, // garanti non-null par le caller
    sellPrice: eurosVersCentimes(article.prix_vente),
    unit: uniteVersCostructorId(article.unite),
  }
}

// Construit le payload Costructor selon la structure ATG (voir
// `lib/atg-devis-structure.ts` pour ajuster l'ordre / les libellés / le matching).
//
// L'ordre des lignes produites :
//   1. En-tête QUALIFICATIONS ATG (lignes type:'text')
//   2. Chaque section transversale (Déplacement, Échafaudage, Lavage, Traitement) :
//      titre + articles extraits des sections façade par mots-clés
//   3. Chaque section façade restante : titre + articles non captés
//
// Les articles sans quantité (null ou <= 0) sont skippés. Une section façade
// dont tous les articles ont été captés par les sections transversales n'est
// pas émise (évite les titres orphelins).
//
// `sections[].articles[].prix_vente` est en euros (DB), converti en centimes ici.
export function construirePayloadDevis(args: {
  contactId: string
  sections: SectionDevis[]
  description: string
}): CostructorQuotePayload {
  const lines: CostructorQuotePayload['lines'] = []

  // 1) En-tête QUALIFICATIONS ATG.
  const entete = STRUCTURE_DEVIS_ATG.entete
  if (entete.titre || entete.lignes.length > 0) {
    const puces = entete.lignes.map((l) => `• ${l}`).join('<br>')
    const enteteHtml = entete.titre
      ? `<strong>${entete.titre}</strong>${puces ? `<br><br>${puces}` : ''}`
      : puces
    lines.push({ type: 'text', description: enteteHtml })
  }

  // 2) Pré-classification des articles : pour chaque article (avec quantité),
  // détermine s'il va dans une section transversale ou dans sa section façade.
  // On garde la référence d'origine pour conserver l'ordre interne par façade.
  const articlesValides = args.sections.flatMap((s) =>
    s.articles
      .filter((a) => a.quantite != null && a.quantite > 0)
      .map((article) => ({
        article,
        sectionOrigine: s.nom,
        sectionTransversale: trouverSectionTransversale(article.libelle),
      })),
  )

  // 3) Sections transversales (titre + articles captés), dans l'ordre déclaré.
  for (const transv of STRUCTURE_DEVIS_ATG.sectionsTransversales) {
    const captures = articlesValides.filter(
      (a) => a.sectionTransversale === transv.titre,
    )
    lines.push({ type: 'text', description: transv.titre })
    for (const { article } of captures) {
      lines.push(ligneProduit(article))
    }
  }

  // 4) Sections façade restantes : on parcourt les sections d'entrée dans leur
  // ordre d'origine et on émet les articles non captés. Une section façade vide
  // après filtrage n'est PAS émise (pas de titre orphelin).
  for (const section of args.sections) {
    const restants = articlesValides.filter(
      (a) =>
        a.sectionOrigine === section.nom && a.sectionTransversale === null,
    )
    if (restants.length === 0) continue
    lines.push({ type: 'text', description: section.nom })
    for (const { article } of restants) {
      lines.push(ligneProduit(article))
    }
  }

  return {
    customer: args.contactId,
    description: args.description,
    lines,
  }
}
