// =============================================================
// Catégories de tickets (métadonnées partagées client + serveur)
// =============================================================
// Volontairement SANS import serveur (pas d'anthropic ici) pour pouvoir être
// importé par le composant client (panneau "Mes demandes"). La classification IA
// vit dans lib/ticket-classifier.ts (serveur uniquement).

export type CategorieCle = 'probleme' | 'amelioration' | 'question' | 'autre'

export interface CategorieMeta {
  cle: CategorieCle
  label: string
  emoji: string
  // Classe Tailwind pour le badge (couleur douce, lisible).
  badge: string
}

// L'ordre ici = l'ordre d'affichage des sections dans "Mes demandes".
export const CATEGORIES: CategorieMeta[] = [
  { cle: 'probleme', label: 'Problèmes', emoji: '🛠️', badge: 'bg-red-50 text-red-700' },
  { cle: 'amelioration', label: 'Améliorations / optimisations', emoji: '💡', badge: 'bg-amber-50 text-amber-700' },
  { cle: 'question', label: 'Questions', emoji: '❓', badge: 'bg-blue-50 text-blue-700' },
  { cle: 'autre', label: 'Autres', emoji: '💬', badge: 'bg-gray-100 text-gray-600' },
]

export const CLES_CATEGORIES: CategorieCle[] = CATEGORIES.map((c) => c.cle)

// Normalise une valeur stockée (peut être null/inconnue) vers une catégorie connue.
export function normaliserCategorie(valeur: string | null | undefined): CategorieCle {
  const v = (valeur ?? '').toLowerCase().trim()
  return (CLES_CATEGORIES as string[]).includes(v) ? (v as CategorieCle) : 'autre'
}

export function metaCategorie(cle: CategorieCle): CategorieMeta {
  return CATEGORIES.find((c) => c.cle === cle) ?? CATEGORIES[CATEGORIES.length - 1]
}
