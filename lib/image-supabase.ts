// Helper d'affichage des photos stockees dans Supabase Storage.
//
// PERFORMANCE MOBILE : les photos du rapport sont stockees pleine resolution
// (URL publique `/storage/v1/object/public/photos/<path>`). Les afficher telles
// quelles en vignette force le telephone a telecharger + decoder plusieurs Mo,
// ce qui bloque le thread principal pendant le scroll. On sert donc une version
// redimensionnee via les transformations d'image Supabase (endpoint `render/image`,
// plan Pro actif) : `/storage/v1/render/image/public/photos/<path>?width=…&quality=…`.
//
// Fail-open : si l'URL ne correspond pas au motif attendu (autre host / bucket /
// URL signee), on renvoie l'URL d'origine inchangee — aucune regression possible.

const MOTIF_OBJET_PUBLIC = '/storage/v1/object/public/'
const SEGMENT_RENDER = '/storage/v1/render/image/public/'

export type OptionsImage = {
  width?: number
  height?: number
  quality?: number // 20-100 ; defaut Supabase = 80
  resize?: 'cover' | 'contain' | 'fill'
}

/**
 * Renvoie une URL d'image Supabase redimensionnee (transformation a la volee).
 * Si `url` n'est pas une URL publique Supabase Storage, renvoie `url` inchangee.
 *
 * ANTI-RECADRAGE (important) : le endpoint Supabase `render/image` applique par
 * defaut le mode `resize=cover`, qui ROGNE l'image pour remplir la cible. Pire,
 * la doc precise que « si une seule dimension est fournie, l'image est
 * redimensionnee ET recadree ». Resultat : un appel `{ width: 800 }` renvoyait
 * une bande tronquee (bug constate sur la previsualisation des rapports, alors
 * que le PDF — qui sert l'originale brute — restait correct).
 *
 * Nos photos de visite doivent rester ENTIERES (comme dans le PDF). On force donc
 * un ajustement proportionnel `contain` (imgproxy `fit`, sans marges ni rognage)
 * dans une boite englobante : si l'appelant ne donne qu'une dimension, on reflete
 * l'autre pour former une boite carree. Un appelant peut toujours demander
 * explicitement un autre mode via `opts.resize` (ex. `cover` pour une vignette
 * carree assumee).
 */
export function urlImageRedimensionnee(url: string, opts: OptionsImage = {}): string {
  if (!url || !url.includes(MOTIF_OBJET_PUBLIC)) return url
  try {
    const u = new URL(url)
    u.pathname = u.pathname.replace(MOTIF_OBJET_PUBLIC, SEGMENT_RENDER)

    // Boite englobante : une seule dimension fournie => on reflete l'autre pour
    // eviter le recadrage automatique de Supabase (cf. bloc ci-dessus).
    const width = opts.width ?? opts.height
    const height = opts.height ?? opts.width
    // Par defaut on ne rogne JAMAIS (contain). Rognage seulement si demande.
    const resize = opts.resize ?? 'contain'

    if (width) u.searchParams.set('width', String(width))
    if (height) u.searchParams.set('height', String(height))
    if (opts.quality) u.searchParams.set('quality', String(opts.quality))
    if (width || height) u.searchParams.set('resize', resize)
    return u.toString()
  } catch {
    return url
  }
}
