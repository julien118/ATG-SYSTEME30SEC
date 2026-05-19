import { NextResponse, type NextRequest } from 'next/server'

// Middleware passthrough (mode démo ATG, pas d'auth).
// Conservé en place pour ne pas casser le matcher d'exclusion des assets.
export function middleware(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|favicon-16.png|favicon-32.png|icon-192.png|icon-512.png|logo-ionnyx.png|og-image.png|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
