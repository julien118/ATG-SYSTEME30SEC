// =============================================================
// GET /api/cron  — Dispatcher cron UNIQUE (Vercel Hobby = 1 cron utile)
// =============================================================
// Declenche quotidiennement (vercel.json : "0 7 * * *", UTC, fenetre ±1h). Centralise :
//   1. keep-alive Supabase (evite la pause d'inactivite du projet),
//   2. sante du modele Anthropic (alerte si retire ; la generation bascule deja seule),
//   3. digest HEBDOMADAIRE le dimanche (getUTCDay === 0),
//   4. digest MENSUEL le 1er du mois (getUTCDate === 1).
// Chaque etape est isolee (try/catch + reportError) : le cron ne crash jamais.
//
// Vercel envoie automatiquement « Authorization: Bearer <CRON_SECRET> » quand la
// variable est definie ; le meme header permet un declenchement manuel (bouton Run).

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MODELE_CLAUDE, probeModele } from '@/lib/anthropic'
import { buildDigest } from '@/lib/usage'
import { notify, nomDeploiement, echapperHtml } from '@/lib/notify'
import { reportError } from '@/lib/monitoring'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const resume: Record<string, unknown> = {}
  const now = new Date()

  // 1) Keep-alive : garde le projet Supabase chaud (requete triviale).
  try {
    const admin = createAdminClient()
    await admin.from('chantiers').select('id', { head: true, count: 'exact' }).limit(1)
    resume.keepAlive = 'ok'
  } catch (e) {
    resume.keepAlive = 'erreur'
    await reportError('Cron — keep-alive Supabase', e)
  }

  // 2) Sante du modele : alerte si retire (la generation bascule deja via MODEL_CHAIN).
  try {
    const healthy = await probeModele(MODELE_CLAUDE)
    resume.modeleSain = healthy
    if (!healthy) {
      await notify({
        text:
          `⚠️ <b>${echapperHtml(nomDeploiement())}</b> — le modèle Anthropic « ${echapperHtml(MODELE_CLAUDE)} » semble RETIRÉ (404).\n` +
          `La génération bascule automatiquement en repli (personne n'est bloqué),\n` +
          `mais pense à mettre à jour la variable ANTHROPIC_MODEL.`,
        kind: 'model-health',
      })
    }
  } catch (e) {
    await reportError('Cron — santé modèle', e)
  }

  // 3) Digest hebdomadaire : chaque dimanche (UTC).
  if (now.getUTCDay() === 0) {
    try {
      await buildDigest('week')
      resume.digestHebdo = 'envoyé'
    } catch (e) {
      await reportError('Cron — digest hebdomadaire', e)
    }
  }

  // 4) Digest mensuel : le 1er du mois (UTC).
  if (now.getUTCDate() === 1) {
    try {
      await buildDigest('month')
      resume.digestMensuel = 'envoyé'
    } catch (e) {
      await reportError('Cron — digest mensuel', e)
    }
  }

  // Heartbeat → Tour de Contrôle (confirme que le cron quotidien a bien tourné).
  // POST résilient : on contrôle le statut HTTP et on ré-essaie sur non-2xx. La Tour
  // renvoie désormais 502 quand la persistance du heartbeat échoue (cold start /
  // pool saturé Supabase) ; un ping silencieusement perdu = fausse alerte URGENT.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://ionnyx-tour-de-controle.vercel.app/api/ingest', {
        method: 'POST',
        headers: { 'x-ionnyx-token': process.env.TOUR_INGEST_SECRET || '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: 'atg', module: 'cron-7h', type: 'heartbeat', titre: 'Cron quotidien ATG OK', detail: resume }),
      })
      if (res.ok) break
      console.error(`[cron] heartbeat Tour: HTTP ${res.status} (tentative ${attempt}/3)`)
    } catch (e) {
      console.error(`[cron] heartbeat Tour (tentative ${attempt}/3):`, e)
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt))
  }

  return NextResponse.json({ ok: true, ...resume })
}
