// =============================================================
// GET /api/usage-digest?period=week|month
// =============================================================
// Construit ET envoie un digest (usage + cout) sur Telegram, et renvoie l'apercu
// JSON. Sert au TEST MANUEL du systeme (le cron, lui, declenche les digests aux
// bonnes dates). Protege par CRON_SECRET si defini.

import { NextResponse } from 'next/server'
import { buildDigest } from '@/lib/usage'
import { reportError } from '@/lib/monitoring'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const period = new URL(request.url).searchParams.get('period') === 'month' ? 'month' : 'week'
    const digest = await buildDigest(period)
    return NextResponse.json({ ok: true, ...digest })
  } catch (e) {
    await reportError('Digest manuel (usage-digest)', e)
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
