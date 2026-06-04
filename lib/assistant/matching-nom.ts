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

// =============================================================
// Matching SOUPLE (bug 2 vague 2 : repli si l'exact ne trouve rien)
// =============================================================
// Tolere les petites fautes de frappe / variations orthographiques. Utilise
// UNIQUEMENT en secours (apres une passe exacte infructueuse), et l'appelant
// signale au redacteur que la correspondance est approchante (invitation a
// confirmer). On peut se permettre cette souplesse car on est en LECTURE SEULE.

// Distance d'edition (Levenshtein) classique, en programmation dynamique.
function distanceEdition(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const ligne = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diagonale = ligne[0]
    ligne[0] = i
    for (let j = 1; j <= b.length; j++) {
      const provisoire = ligne[j]
      const cout = a[i - 1] === b[j - 1] ? 0 : 1
      ligne[j] = Math.min(ligne[j] + 1, ligne[j - 1] + 1, diagonale + cout)
      diagonale = provisoire
    }
  }
  return ligne[b.length]
}

// Ecart de lettres tolere selon la longueur du plus long jeton : rien sur les
// jetons courts (2-3, ou 1 faute change l'identite), 1 sur 4-6, 2 sur 7+.
function toleranceJeton(t: string, u: string): number {
  const maxLen = Math.max(t.length, u.length)
  if (maxLen <= 3) return 0
  if (maxLen <= 6) return 1
  return 2
}

// Deux jetons concordent souplement si : egaux, OU l'un est sous-chaine de
// l'autre, OU leur distance d'edition tient dans la tolerance liee a la longueur.
function concordeJeton(t: string, u: string): boolean {
  if (t === u) return true
  if (u.includes(t) || t.includes(u)) return true
  return distanceEdition(t, u) <= toleranceJeton(t, u)
}

// Nombre minimal de jetons concordants exige : TOUS si N <= 2 (sinon on
// rapprocherait tout "Saint X" / "Résidence Y"), sinon la majorite ceil(2N/3).
function seuilMajorite(n: number): number {
  if (n <= 2) return n
  return Math.ceil((n * 2) / 3)
}

// Correspondance souple entre un nom RECHERCHE et un nom CIBLE : on tokenise les
// deux ; un jeton de la recherche "matche" s'il concorde souplement avec au moins
// un jeton de la cible ; on exige le seuil de majorite. A n'appeler qu'en secours
// (apres l'exact). Partage par les domaines comptes rendus et clients.
export function correspondNomSouple(recherche: string, nomCible: string): boolean {
  const jetons = jetonsSignificatifs(recherche)
  if (jetons.length === 0) return false
  const jetonsCible = jetonsSignificatifs(nomCible)
  if (jetonsCible.length === 0) return false
  const concordants = jetons.filter((t) => jetonsCible.some((u) => concordeJeton(t, u))).length
  return concordants >= seuilMajorite(jetons.length)
}
