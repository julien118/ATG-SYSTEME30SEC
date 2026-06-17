// Sanitisation centralisée des cibles de redirection (anti open-redirect).
// Utilisée par la page de connexion (au retour de login) ET réutilisable côté
// serveur (middleware) pour ne jamais renvoyer vers une URL externe.

const DESTINATION_DEFAUT = '/chantiers'

/**
 * Renvoie `brut` seulement si c'est un chemin INTERNE sûr, sinon `/chantiers`.
 * Règle stricte : un seul « / » au début, 2e caractère ni « / » ni « \ », et
 * aucun espace ni backslash ensuite (\s couvre espace, tab, saut de ligne, CR).
 * Rejette //evil.com, /\evil.com, les schémas (http:, javascript:) et les
 * injections d'en-tête. Accepte un éventuel query string (?a=b).
 */
export function cibleInterneSure(brut: string | null | undefined): string {
  if (!brut) return DESTINATION_DEFAUT
  let valeur = brut
  try {
    valeur = decodeURIComponent(brut)
  } catch {
    return DESTINATION_DEFAUT
  }
  if (/^\/(?![/\\])[^\s\\]*$/.test(valeur)) return valeur
  return DESTINATION_DEFAUT
}
