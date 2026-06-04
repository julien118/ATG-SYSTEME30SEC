// =============================================================
// Helpers PARTAGES de matching de NOM (assistant)
// =============================================================
// Normalisation + jetons significatifs, mutualises entre le domaine « comptes
// rendus » et le domaine « clients » pour eviter toute divergence. Comportement
// strictement identique a ce qui vivait en double dans chaque domaine.
// NB : la logique de matching SOUPLE (tolerance aux fautes, cf bug 2) sera
// ajoutee ici aussi dans un second temps, et branchee aux deux domaines.

// Normalisation generale d'un texte/nom : retire le HTML, minuscules, accents,
// espaces compresses.
export function normaliser(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Civilites et particules a ignorer dans le matching de nom : sans elles,
// "M. Dupont" doit retrouver "M. et Mme Dupont".
export const MOTS_VIDES_NOM = new Set([
  'm', 'mr', 'mme', 'mlle', 'monsieur', 'madame', 'mademoiselle',
  'et', 'de', 'du', 'des', 'la', 'le', 'les', 'l', 'aux', 'a',
])

// Jetons significatifs d'un nom : >= 2 lettres, hors civilites/particules.
export function jetonsSignificatifs(nom: string): string[] {
  return normaliser(nom)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !MOTS_VIDES_NOM.has(t))
}
