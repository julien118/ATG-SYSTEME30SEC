// =============================================================
// POST /api/tickets/[id]/resolu — Olivier clôt un fil
// =============================================================
// Marque le fil comme résolu (archivé, toujours consultable) et prévient Julien
// sur Telegram. Protégé par le middleware. (Julien, lui, clôt via "/resolu" en
// réponse sur Telegram, géré dans le webhook.)

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ATG_USER_ID } from '@/lib/atg'
import { sendTelegramAvecId, echapperHtml } from '@/lib/notify'
import { reportError } from '@/lib/monitoring'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const admin = createAdminClient()
    const { data: ticket } = await admin
      .from('tickets')
      .select('id, titre')
      .eq('id', params.id)
      .eq('user_id', ATG_USER_ID)
      .maybeSingle()
    if (!ticket) return NextResponse.json({ error: 'introuvable' }, { status: 404 })

    await admin
      .from('tickets')
      .update({ statut: 'resolu', derniere_activite_le: new Date().toISOString() })
      .eq('id', ticket.id)

    const { data: dernier } = await admin
      .from('ticket_messages')
      .select('telegram_message_id')
      .eq('ticket_id', ticket.id)
      .not('telegram_message_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const sujet = ticket.titre?.trim() ? `« ${ticket.titre.trim()} »` : 'cette demande'
    await sendTelegramAvecId(
      `✅ Olivier a marqué ${echapperHtml(sujet)} comme résolue.`,
      dernier?.telegram_message_id ?? undefined,
    )

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[api/tickets/[id]/resolu POST]', e)
    await reportError('Clôture ticket', e)
    return NextResponse.json({ error: 'erreur' }, { status: 500 })
  }
}
