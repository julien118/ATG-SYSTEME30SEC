export type ChantierStatut = 'planifie' | 'en_cours' | 'termine' | 'rapport_genere'
export type CaptureType = 'vocal' | 'photo'

export interface Profile {
  id: string
  prenom: string
  nom: string
  telephone: string | null
  metier: string | null
  entreprise: string | null
  rapports_generes: number
  created_at: string
}

export interface Chantier {
  id: string
  user_id: string
  client_nom: string
  client_adresse: string
  client_telephone: string
  client_email: string
  date_visite: string
  objet_travaux: string
  statut: ChantierStatut
  created_at: string
  updated_at: string
}

export interface CaptureItem {
  id: string
  chantier_id: string
  type: CaptureType
  position: number
  audio_url: string | null
  transcription: string | null
  photo_url: string | null
  linked_photo_id: string | null
  created_at: string
}

export interface RapportObservationPhoto {
  url: string
  legende: string
}

export interface RapportObservation {
  titre: string
  description: string
  points_vigilance: string[]
  photos: RapportObservationPhoto[]
}

export interface RapportContenu {
  client: {
    nom: string
    adresse: string
    telephone: string
    email: string
    date_visite: string
  }
  observations: RapportObservation[]
  acces_chantier: string
  duree_estimee: string
  notes: string
}

export interface Rapport {
  id: string
  chantier_id: string
  contenu_json: RapportContenu
  created_at: string
  updated_at: string
}

// =============================================================
// Phase 2 — Module Devis Express ATG
// =============================================================

export interface ArticleBibliotheque {
  id: string
  costructor_article_id: string
  libelle: string
  unite: string
  prix_vente: number
  mots_cles: string[] | null
  synchronise_le: string
}

// Article dans une section de devis (avec quantité saisie ou null avant métrés).
export interface ArticleDevis {
  costructor_article_id: string
  libelle: string
  unite: string
  prix_vente: number
  quantite: number | null
  // Description technique 3-7 lignes, générée par l'IA, ancrée dans le contexte
  // de la zone (Façade Sud / Nord / Pignon Est) et des observations dictées.
  // Visible avant la saisie des métrés (Phase A) puis poussée dans Costructor.
  description_technique: string
}

export interface SectionDevis {
  nom: string // ex: "FAÇADE SUD"
  articles: ArticleDevis[]
}

export type DevisStatut =
  | 'brouillon'
  | 'sections_proposees'
  | 'metres_en_cours'
  | 'pousse_costructor'
  | 'echec'

export interface Devis {
  id: string
  chantier_id: string
  statut: DevisStatut
  sections_proposees: SectionDevis[] | null
  sections_finales: SectionDevis[] | null
  total_ht: number | null
  total_ttc: number | null
  costructor_devis_id: string | null
  costructor_devis_url: string | null
  pousse_le: string | null
  erreur_push: string | null
  cree_le: string
  modifie_le: string
}

// ---------- Sorties JSON attendues des prompts ----------

export interface PropositionDevisIA {
  sections: SectionDevis[]
}

export interface MetricsParseResult {
  updates: Array<{
    section_name: string
    article_label: string
    quantity: number
    confidence: 'high' | 'medium' | 'low'
  }>
  ignored: string[]
}

// ---------- Types API Costructor (validés par l'audit) ----------

export type CostructorQuoteLine =
  | { type: 'text'; description: string } // séparateur de section
  | {
      type: 'product'
      product: string // ID produit (prod_xxx)
      description: string // libellé colonne DÉSIGNATION
      quantity: number
      sellPrice: number // EN CENTIMES
      unit: string // ID unité (unit_xxx)
    }

export interface CostructorQuotePayload {
  customer: string // ID contact (cnt_xxx)
  description: string
  lines: CostructorQuoteLine[]
}

export interface CostructorQuoteResponse {
  id: string
  reference?: string
  total?: number // en centimes
  url?: string
}

export interface CostructorProduct {
  id: string
  name: string
  description?: string
  unit?: string
  sellPrice?: number
}

export interface CostructorContactEmail {
  email: string
  primary: boolean
}

export interface CostructorContactPhone {
  phone: string
  primary: boolean
}

// Adresse Costructor : objet imbriqué + drapeau primary. Forme confirmée par GET
// /contacts : addresses:[{ address:{ street, city, postal_code, country }, primary }].
export interface CostructorContactAddress {
  address: {
    street?: string | null
    city?: string | null
    postal_code?: string | null
    country?: string | null
  } | null
  primary?: boolean
}

export interface CostructorContact {
  id: string
  type: string // 'client' | 'lead' | ...
  legalStatus: string // 'individual' | 'company' | ...
  firstName: string | null
  lastName: string | null
  companyName: string | null
  fullName: string | null
  emails: CostructorContactEmail[]
  phones: CostructorContactPhone[]
  addresses: CostructorContactAddress[]
  // Mirroir du primary, présent dans la réponse mais redondant à l'envoi.
  email: string | null
  phone: string | null
}

export type ContactMatchType = 'email' | 'phone' | 'nom' | 'created'

export interface ResultatRechercheContact {
  contactId: string
  cree: boolean
  matchType: ContactMatchType
}
