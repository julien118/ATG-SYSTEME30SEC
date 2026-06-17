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
 */
export function urlImageRedimensionnee(url: string, opts: OptionsImage = {}): string {
  if (!url || !url.includes(MOTIF_OBJET_PUBLIC)) return url
  try {
    const u = new URL(url)
    u.pathname = u.pathname.replace(MOTIF_OBJET_PUBLIC, SEGMENT_RENDER)
    if (opts.width) u.searchParams.set('width', String(opts.width))
    if (opts.height) u.searchParams.set('height', String(opts.height))
    if (opts.quality) u.searchParams.set('quality', String(opts.quality))
    if (opts.resize) u.searchParams.set('resize', opts.resize)
    return u.toString()
  } catch {
    return url
  }
}
