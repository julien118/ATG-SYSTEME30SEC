// =============================================================
// POST /api/client-error
// =============================================================
// Recoit les crashs cote NAVIGATEUR (depuis les error boundaries app/error.tsx et
// app/global-error.tsx) et les transforme en alerte serveur via reportError.
// C'est ICI (cote serveur) que vit le token Telegram : il ne transite JAMAIS par le
// navigateur. Endpoint public (meme origine) : on ne revele rien, on repond
// toujours { ok: true } et on ne throw jamais.

import { NextResponse } from 'next/server'
import { reportError } from '@/lib/monitoring'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      message?: string
      stack?: string
      digest?: string
      url?: string
      scope?: string
    }

    const message = String(body.message || 'Erreur navigateur inconnue').slice(0, 500)
    const url = String(body.url || '').slice(0, 300)
    const stack = String(body.stack || '').slice(0, 1500)
    const scope = body.scope === 'global' ? ' (global)' : ''

    const erreur = new Error(message)
    if (stack) erreur.stack = stack
    const contexte = `Interface navigateur${scope}${url ? ` — ${url}` : ''}`

    await reportError(contexte, erreur)
  } catch {
    // On n'expose jamais d'erreur a un client : le endpoint reste muet.
  }
  return NextResponse.json({ ok: true })
}
