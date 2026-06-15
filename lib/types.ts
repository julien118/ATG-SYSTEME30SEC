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
  // Ref d'occurrence stable vers la ligne PRODUIT du modele dont cet article est
  // derive (moteur clonage), ex 'prod_xxx#0' / 'prod_xxx#1' pour distinguer un
  // meme poste repete (partie chauffee / non chauffee). Permet au push (commit 3)
  // de relier l'article a la bonne ligne du modele. Absent en moteur plat
  // (article issu de la bibliotheque, sans modele d'origine).
  ref_modele?: string
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

// Moteur ayant produit le devis (socle ITE).
//   'plat'    = moteur historique (bibliotheque plate + IA), comportement actuel.
//   'clonage' = moteur de clonage du devis-modele d'Olivier (ITE, branche plus tard).
export type MoteurDevis = 'plat' | 'clonage'

// Compte Costructor source d'un modele lu. 'test' = compte test Julien (clé
// d'ecriture) ; 'olivier' = compte d'Olivier (lecture seule GET). Les product.id
// / tax.id etant propres au compte, un snapshot lu sur un compte ne peut etre
// pousse que sur CE compte (garde de coherence cote push).
export type CompteCostructor = 'test' | 'olivier'

// Snapshot fige de l'arbre d'un devis-modele Costructor (reponse GET
// /quotes/{id}?_expand=lines), capture sur le devis a la derivation pour que le
// push en mode clonage reconstruise a l'identique sans re-interroger Costructor.
// Volontairement permissif (stocke en JSONB) : la forme exacte des lignes est
// portee par `LigneModele` dans lib/atg-devis-modele.ts. On NE l'importe PAS ici
// pour ne pas creer de cycle (types -> atg-devis-modele -> costructor -> types) ;
// le consommateur (push clonage) castera `lines` en LigneModele[].
export interface ModeleSnapshot {
  id?: string | null
  subtotal?: number | null
  lines: unknown[]
  // Compte source du modele lu (garde de coherence au push : un snapshot lu chez
  // Olivier ne peut pas etre pousse sur le compte test, ids propres au compte).
  // Absent (devis anterieurs) => traite comme 'test'.
  compte?: CompteCostructor
}

export interface Devis {
  id: string
  chantier_id: string
  statut: DevisStatut
  sections_proposees: SectionDevis[] | null
  sections_finales: SectionDevis[] | null
  total_ht: number | null
  total_ttc: number | null
  // Taux de TVA en points de pourcentage (10 = 10 %). Defaut 10. Ajustable par le
  // pro sur l'ecran recap avant l'envoi, applique au push et aux totaux (lot 5.2).
  tva_taux: number | null
  costructor_devis_id: string | null
  costructor_devis_url: string | null
  pousse_le: string | null
  erreur_push: string | null
  // Moteur de generation (socle ITE). Defaut 'plat' = comportement actuel ; le
  // clonage n'est encore aiguille nulle part a ce stade. modele_id/modele_snapshot
  // ne sont renseignes qu'en mode 'clonage' (null en mode plat).
  moteur: MoteurDevis
  modele_id: string | null
  modele_snapshot: ModeleSnapshot | null
  cree_le: string
  modifie_le: string
}

// ---------- Sorties JSON attendues des prompts ----------

export interface PropositionDevisIA {
  sections: SectionDevis[]
}

// Une mesure dictee rattachee a un ou plusieurs articles du devis (etape 1
// prefil metres). La distinction METIER (validee par Julien) est portee par
// `portee` + `articles_cibles` :
//   - portee 'mur'   = surface GLOBALE du mur (« facade sud 45 m² ») -> tous les
//     postes surfaciques globaux de la section (echafaudage, lavage, traitement,
//     isolant, systeme, finition...). `articles_cibles` les liste tous.
//   - portee 'poste' = article explicitement NOMME avec sa propre mesure
//     (« l'isolant fait 45 m² », « 6 ml d'appuis ») -> ce seul article.
// `unite`/`portee`/`confiance` sont des chaines (issues de Claude) normalisees /
// validees en code ; valeurs attendues commentees.
export interface MesureDictee {
  section: string
  valeur: number
  unite: string // attendu : "m²" | "ml" | "u"
  portee: string // attendu : "mur" | "poste"
  articles_cibles: string[] // libelles EXACTS recopies de la structure
  confiance: string // attendu : "haute" | "basse"
}

export interface MetricsParseResult {
  mesures: MesureDictee[]
  // Mesures dictees non rattachees de facon sure (trace, jamais appliquees).
  ignores: string[]
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
      // TVA de la ligne en POINTS DE BASE (1000 = 10 %). Calcule depuis le taux
      // global choisi (lot 5.2) : independant des ids de taxe du compte.
      taxRate?: number
    }

export interface CostructorQuotePayload {
  customer: string // ID contact (cnt_xxx)
  description: string
  lines: CostructorQuoteLine[]
  // Nom/titre parlant du devis, construit depuis chantier.objet_travaux (lot 6.1).
  name?: string
  // Date de la visite technique prealable, format AAAA-MM-JJ (lot 6.2).
  preVisitAt?: string
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

// Article de la bibliotheque Costructor nettoye pour l'autocompletion de
// remplacement (lot 4.3). Forme alignee sur ArticleDevis (champs utiles) pour un
// remplacement drop-in dans une section de devis.
export interface ArticleRemplacable {
  costructor_article_id: string
  libelle: string
  unite: string
  prix_vente: number // en euros
}

// Contact Costructor nettoye pour l'autocompletion a la creation de visite
// (groupe C). LECTURE SEULE : sert a proposer et preremplir, jamais a ecrire.
export interface ContactRecherche {
  id: string
  nom: string
  ville: string | null
  email: string | null
  telephone: string | null
  adresse: string | null // chaine "rue cp ville" pour preremplir le champ adresse
}

// Proposition unifiee pour l'autocompletion du nom de client/chantier : provient
// soit des contacts Costructor, soit des anciennes visites de l'app (Supabase).
export interface PropositionContact {
  nom: string
  ville: string | null
  email: string | null
  telephone: string | null
  adresse: string | null
  source: 'costructor' | 'app'
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
