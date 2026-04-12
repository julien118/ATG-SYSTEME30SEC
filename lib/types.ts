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
