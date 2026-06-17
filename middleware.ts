import { NextResponse, type NextRequest } from 'next/server'
import { verifySession, signSession, COOKIE_NAME, SESSION_DUREE_MS } from '@/lib/auth-gate'

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
    pathname === '/api/client-error'
  )
}

// Porte d'accès single-user : tout est protégé sauf l'allowlist publique.
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (estPublique(pathname)) return NextResponse.next()

  const connecte = await verifySession(request.cookies.get(COOKIE_NAME)?.value)
  if (connecte) {
    // Session glissante : on reprolonge le cookie à CHAQUE visite. Tant qu'Olivier
    // utilise l'app, sa session ne vieillit jamais → il n'est jamais déconnecté
    // tout seul. (Seul un changement d'email/mot de passe met fin aux sessions.)
    const res = NextResponse.next()
    try {
      res.cookies.set(COOKIE_NAME, await signSession(), {
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
    return res
  }

  // Non connecté : les API répondent 401 (pas de redirection), les pages
  // renvoient vers /login en mémorisant la destination.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'non_authentifie' }, { status: 401 })
  }
  const url = request.nextUrl.clone()
  const destination = pathname + request.nextUrl.search
  url.pathname = '/login'
  url.search = ''
  url.searchParams.set('next', destination)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|favicon-16.png|favicon-32.png|icon-192.png|icon-512.png|logo-ionnyx.png|og-image.png|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
