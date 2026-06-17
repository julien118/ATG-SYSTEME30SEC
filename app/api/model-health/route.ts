// =============================================================
// GET /api/model-health
// =============================================================
// Canari de sante du modele Anthropic : un probe minimal (max_tokens:1) sur le
// modele prefere (MODELE_CLAUDE). Si le modele est retire/injoignable, on alerte
// (la generation, elle, bascule deja automatiquement via MODEL_CHAIN, donc personne
// n'est bloque). Utilisable seul ou appele par le cron.
//
// Protege par CRON_SECRET si defini (header Authorization: Bearer <secret>).

import { NextResponse } from 'next/server'
import { MODELE_CLAUDE, probeModele } from '@/lib/anthropic'
import { notify, nomDeploiement, echapperHtml } from '@/lib/notify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const healthy = await probeModele(MODELE_CLAUDE)
  if (!healthy) {
    await notify({
      text:
        `⚠️ <b>${echapperHtml(nomDeploiement())}</b> — le modèle Anthropic « ${echapperHtml(MODELE_CLAUDE)} » semble RETIRÉ (404).\n` +
        `La génération bascule automatiquement en repli (personne n'est bloqué),\n` +
        `mais pense à mettre à jour la variable ANTHROPIC_MODEL.`,
      kind: 'model-health',
    })
  }
  return NextResponse.json({ healthy, model: MODELE_CLAUDE })
}
