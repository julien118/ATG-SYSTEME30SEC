import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// Modele Claude unique pour TOUTE la couche IA de l'app (generation de rapport,
// assistant, proposition de devis, transcription/reponctuation, parsing metres...).
// Centralise ICI pour qu'une retraite de modele par Anthropic soit un changement a
// UN SEUL endroit : le 15 juin 2026, claude-sonnet-4-20250514 a ete retire et a
// casse toute la couche IA d'un coup. Chaine exacte, sans suffixe de date.
export const MODELE_CLAUDE = 'claude-sonnet-4-6'
