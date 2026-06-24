import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { verifySession, signSession, COOKIE_NAME, SESSION_DUREE_MS } from '@/lib/auth-gate'
import { cibleInterneSure } from '@/lib/redirection-sure'

// Routes accessibles SANS connexion :
//  - /login + /api/auth/* : nécessaires pour se connecter
//  - /r/* + /api/export-pdf/* : le lien du compte-rendu PDF partagé aux
//    CLIENTS d'Olivier depuis le devis Costructor (ils n'ont pas de compte)
//  - surveillance (/api/cron, /api/usage-digest, /api/model-health) : appelées
//    par le cron Vercel / les tests SANS session (le cron envoie le bearer
//    CRON_SECRET mais pas le cookie de session) → sans cette exception, la porte
//    d'accès renverrait 401 AVANT le handler et le cron ne tournerait jamais.
//    Ces routes restent protégées par leur PROPRE vérification de CRON_SECRET.
//  - /api/client-error : volontairement public (remontée des crashs navigateur,
//    même hors session, ex. écran de login). N'expose rien, répond toujours ok.
//  - /api/telegram-webhook : appelée par Telegram (réponses de Julien aux tickets),
//    qui n'a pas le cookie de session. Protégée par son PROPRE secret token
//    (x-telegram-bot-api-secret-token vérifié dans le handler).
// (les assets statiques sont déjà exclus par le `matcher` ci-dessous)
function estPublique(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/r/') ||
    pathname.startsWith('/api/export-pdf/') ||
    pathname === '/api/cron' ||
    pathname === '/api/usage-digest' ||
    pathname === '/api/model-health' ||
    pathname === '/api/client-error' ||
    pathname === '/api/telegram-webhook'
  )
}

// Porte d'accès single-user. DEUX couches volontairement superposées :
//  1. Session Supabase Auth (rafraîchie ici) : c'est elle qui protège les
//     DONNÉES via la RLS (le navigateur parle directement à Supabase). Sans
//     session, la RLS ne renvoie rien — la clé anon publique devient inerte.
//  2. Cookie de session maison (HMAC) : autorité pour l'accès aux PAGES pendant
//     la transition. Pourra être retiré une fois la session Supabase éprouvée.
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // --- 1) Rafraîchir la session Supabase (rotation des tokens) ---
  // Patron officiel @supabase/ssr : ne RIEN exécuter entre createServerClient et
  // getUser(). On accumule les cookies mis à jour sur `response`. Best-effort :
  // tout échec est avalé pour ne JAMAIS bloquer la porte d'accès.
  let response = NextResponse.next({ request })
  let sessionSupabase: { id: string } | null = null
  let sessionVerifiee = false
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            response = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            )
          },
        },
      },
    )
    const { data } = await supabase.auth.getUser()
    sessionSupabase = data.user
    sessionVerifiee = true // la vérif a abouti (session présente OU absente, mais pas d'erreur réseau)
  } catch {
    // Un souci de rafraîchissement de session ne doit jamais verrouiller l'app.
  }

  // --- 2) Routes publiques : laisser passer (cookies de session à jour) ---
  if (estPublique(pathname)) return response

  // --- 3) Porte d'accès maison (autorité pour les PAGES) ---
  const connecte = await verifySession(request.cookies.get(COOKIE_NAME)?.value)
  if (connecte) {
    // FILET ANTI PAGE-VIDE : cookie maison valide MAIS aucune session Supabase
    // (typiquement un ancien cookie d'avant la bascule Auth). Comme la RLS est
    // active, les données seraient VIDES → on force une reconnexion qui rétablit
    // la session Supabase. Uniquement pour les PAGES, et SEULEMENT si la vérif a
    // abouti (sinon une erreur réseau transitoire causerait un faux-logout).
    if (sessionVerifiee && !sessionSupabase && !pathname.startsWith('/api/')) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = ''
      url.searchParams.set('next', cibleInterneSure(pathname + request.nextUrl.search))
      const redirect = NextResponse.redirect(url)
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c))
      return redirect
    }
    // Session glissante : on reprolonge le cookie à CHAQUE visite. Tant qu'Olivier
    // utilise l'app, sa session ne vieillit jamais → il n'est jamais déconnecté
    // tout seul. (Seul un changement d'email/mot de passe met fin aux sessions.)
    try {
      response.cookies.set(COOKIE_NAME, await signSession(), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: Math.floor(SESSION_DUREE_MS / 1000),
      })
    } catch {
      // Si la re-signature échoue, on laisse passer sans prolonger : on ne bloque
      // jamais l'accès d'un utilisateur déjà authentifié pour un souci de confort.
    }
    return response
  }

  // --- 4) Non connecté : API → 401, pages → /login (cookies de session recopiés) ---
  if (pathname.startsWith('/api/')) {
    const r = NextResponse.json({ error: 'non_authentifie' }, { status: 401 })
    response.cookies.getAll().forEach((c) => r.cookies.set(c))
    return r
  }
  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  url.searchParams.set('next', cibleInterneSure(pathname + request.nextUrl.search))
  const redirect = NextResponse.redirect(url)
  response.cookies.getAll().forEach((c) => redirect.cookies.set(c))
  return redirect
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|favicon-16.png|favicon-32.png|icon-192.png|icon-512.png|logo-ionnyx.png|og-image.png|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
