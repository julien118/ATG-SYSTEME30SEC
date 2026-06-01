/**
 * Compress image via Canvas API
 * Max 1920px width, JPEG quality 0.8, no upscaling
 */
export function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const MAX_WIDTH = 1920
      const QUALITY = 0.8

      let { width, height } = img
      if (width > MAX_WIDTH) {
        height = (height * MAX_WIDTH) / width
        width = MAX_WIDTH
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('Compression failed'))
        },
        'image/jpeg',
        QUALITY
      )
    }
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = URL.createObjectURL(file)
  })
}

/**
 * Upload with exponential backoff retry (3 attempts: 1s, 2s, 4s)
 */
export async function uploadWithRetry(
  fn: () => Promise<{ error: unknown }>,
  maxRetries = 3
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { error } = await fn()
    if (!error) return
    if (attempt < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000))
    } else {
      throw new Error('Upload failed after retries')
    }
  }
}

/**
 * Fetch with timeout (AbortController)
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 30000
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Format a date to French locale
 */
export function formatDateFr(dateStr: string | null) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Format datetime for input[type="datetime-local"]
 */
export function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// =============================================================
// Saisie de la date et de l'heure de visite (lot 1.2)
// =============================================================
// Plage de travail : creneaux de 30 min de 07:00 a 18:30 (dernier depart
// planifiable a 18h30 pour tenir dans la journee). Le stockage reste un
// TIMESTAMPTZ : on combine jour + creneau en une Date, puis .toISOString().

const HEURE_DEBUT = 7 // 07:00
const HEURE_FIN = 18 // dernier creneau a 18:30 (on s'arrete avant 19:00)
const PAS_MIN = 30

const pad2 = (n: number) => n.toString().padStart(2, '0')

// Liste des creneaux horaires valides : ['07:00','07:30',...,'18:30'].
export function creneauxHoraires(): string[] {
  const out: string[] = []
  for (let h = HEURE_DEBUT; h <= HEURE_FIN; h++) {
    for (let m = 0; m < 60; m += PAS_MIN) {
      out.push(`${pad2(h)}:${pad2(m)}`)
    }
  }
  return out
}

// Jour d'une Date au format 'YYYY-MM-DD' pour <input type="date">.
export function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

// Minutes depuis minuit d'un creneau 'HH:mm'.
function minutesDepuisMinuit(heure: string): number {
  const [h, m] = heure.split(':').map((x) => parseInt(x, 10))
  return h * 60 + m
}

const MIN_PREMIER = HEURE_DEBUT * 60 // 07:00
const MIN_DERNIER = HEURE_FIN * 60 + 30 // 18:30

// Creneau ('HH:mm') a utiliser PAR DEFAUT a la creation : on arrondit l'heure
// au creneau de 30 min SUPERIEUR ou egal, borne dans [07:00, 18:30]. Ex : 14h17
// -> 14h30, 14h45 -> 15h00, avant 7h -> 07:00, apres 18h30 -> 07:00.
export function arrondirAuCreneau(date: Date): string {
  const m = date.getHours() * 60 + date.getMinutes()
  if (m > MIN_DERNIER || m < MIN_PREMIER) return '07:00'
  const arrondi = Math.ceil(m / PAS_MIN) * PAS_MIN
  const borne = Math.min(arrondi, MIN_DERNIER)
  return `${pad2(Math.floor(borne / 60))}:${pad2(borne % 60)}`
}

// Creneau ('HH:mm') le PLUS PROCHE d'une heure quelconque, borne dans la plage.
// Sert a un chantier existant dont l'heure stockee n'est pas un creneau rond
// (donnee plus ancienne, ex 14h17) : on la cale sans planter.
export function heureLaPlusProche(date: Date): string {
  const m = date.getHours() * 60 + date.getMinutes()
  const borne = Math.min(Math.max(m, MIN_PREMIER), MIN_DERNIER)
  const arrondi = Math.round(borne / PAS_MIN) * PAS_MIN
  const final = Math.min(Math.max(arrondi, MIN_PREMIER), MIN_DERNIER)
  return `${pad2(Math.floor(final / 60))}:${pad2(final % 60)}`
}

// Combine un jour ('YYYY-MM-DD') et un creneau ('HH:mm') en une Date locale
// (pour stockage via .toISOString(), format inchange).
export function combinerDateHeure(jour: string, heure: string): Date {
  const [a, mo, j] = jour.split('-').map((x) => parseInt(x, 10))
  const [h, mi] = heure.split(':').map((x) => parseInt(x, 10))
  return new Date(a, mo - 1, j, h, mi, 0, 0)
}
