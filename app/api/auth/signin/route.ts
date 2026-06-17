import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  verifyEmail,
  verifyPassword,
  signSession,
  configurationManquante,
  COOKIE_NAME,
  SESSION_DUREE_MS,
} from '@/lib/auth-gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Throttle best-effort en mémoire (par IP). Sur serverless les instances ne
// partagent pas cette map ; le vrai rempart reste un mot de passe fort + le
// délai systématique sur échec. C'est une barrière de confort, pas l'unique.
const tentatives = new Map<string, { n: number; premier: number }>()
const FENETRE_MS = 15 * 60 * 1000
const MAX_ECHECS = 10

export async function POST(request: Request) {
  // Garde de configuration : si un secret manque/est trop court, on renvoie une
  // erreur SERVEUR distincte (500) — surtout pas un « mot de passe incorrect »
  // (401) trompeur. On logge le NOM de la variable fautive, jamais sa valeur.
  const manque = configurationManquante()
  if (manque) {
    console.error('[auth] configuration incomplète :', manque)
    return NextResponse.json({ error: 'configuration_incomplete' }, { status: 500 })
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'inconnue'
  const now = Date.now()
  const rec = tentatives.get(ip)
  if (rec && now - rec.premier < FENETRE_MS && rec.n >= MAX_ECHECS) {
    const resteSec = Math.ceil((FENETRE_MS - (now - rec.premier)) / 1000)
    return NextResponse.json(
      { error: 'trop_de_tentatives' },
      { status: 429, headers: { 'Retry-After': String(resteSec) } }
    )
  }

  let email = ''
  let motDePasse = ''
  try {
    const body = await request.json()
    if (typeof body?.email === 'string') email = body.email
    if (typeof body?.motDePasse === 'string') motDePasse = body.motDePasse
  } catch {
    // corps absent / non-JSON → identifiants vides → 401
  }

  // On vérifie les DEUX secrets sans court-circuit (Promise.all) : l'accès
  // n'est accordé que si l'email ET le mot de passe correspondent. L'erreur
  // renvoyée reste générique pour ne pas révéler lequel des deux est faux.
  const [emailOk, motDePasseOk] = await Promise.all([
    verifyEmail(email),
    verifyPassword(motDePasse),
  ])
  const ok = emailOk && motDePasseOk

  // Délai systématique anti-bruteforce (constant, indépendant du résultat).
  await new Promise((r) => setTimeout(r, 400))

  if (!ok) {
    tentatives.set(ip, { n: (rec?.n ?? 0) + 1, premier: rec?.premier ?? now })
    return NextResponse.json({ error: 'mot_de_passe_invalide' }, { status: 401 })
  }

  tentatives.delete(ip)
  const value = await signSession(SESSION_DUREE_MS)
  cookies().set(COOKIE_NAME, value, {
    httpOnly: true,
    // Secure en prod (HTTPS) ; désactivé en dev pour http://localhost.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_DUREE_MS / 1000),
  })
  return NextResponse.json({ ok: true })
}
