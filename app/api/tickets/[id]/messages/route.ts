// =============================================================
// POST /api/tickets/[id]/messages — Olivier répond dans un fil
// =============================================================
// Ajoute un message d'Olivier au fil (texte + vocal OGG optionnel), rouvre le fil
// si besoin, et le transmet à Julien sur Telegram (en réponse au dernier message
// du fil pour le threader). Mémorise le message_id pour matcher les futures
// réponses de Julien. Protégé par le middleware.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ATG_USER_ID } from '@/lib/atg'
import { sendTelegramAvecId, sendTelegramFichierAudio } from '@/lib/notify'
import { formaterReponseOlivier } from '@/lib/ticket-telegram'
import { reportError } from '@/lib/monitoring'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function lireCorps(request: Request): Promise<{ message: string; audio: Blob | null }> {
  const ct = request.headers.get('content-type') || ''
  if (ct.includes('multipart/form-data')) {
    const form = await request.formData()
    const a = form.get('audio')
    return { message: String(form.get('message') ?? ''), audio: a instanceof Blob && a.size > 0 ? a : null }
  }
  const body = (await request.json().catch(() => ({}))) as { message?: unknown }
  return { message: String(body.message ?? ''), audio: null }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const admin = createAdminClient()
    const { data: ticket } = await admin
      .from('tickets')
      .select('id, titre')
      .eq('id', params.id)
      .eq('user_id', ATG_USER_ID)
      .maybeSingle()
    if (!ticket) return NextResponse.json({ error: 'introuvable' }, { status: 404 })

    const { message: raw, audio } = await lireCorps(request)
    let message = raw.trim().slice(0, 4000)
    if (!message && audio) message = '🎤 Message vocal'
    if (!message) return NextResponse.json({ error: 'message_vide' }, { status: 400 })

    // Dernier message du fil déjà posté sur Telegram -> on y répond (threading).
    const { data: dernier } = await admin
      .from('ticket_messages')
      .select('telegram_message_id')
      .eq('ticket_id', ticket.id)
      .not('telegram_message_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const replyTo = dernier?.telegram_message_id ?? undefined

    const messageId = await sendTelegramAvecId(
      formaterReponseOlivier(ticket.titre, message),
      replyTo,
    )
    await admin.from('ticket_messages').insert({
      ticket_id: ticket.id,
      auteur: 'olivier',
      texte: message,
      telegram_message_id: messageId,
    })
    // Relance = le fil redevient ouvert + remonte en tête.
    await admin
      .from('tickets')
      .update({ statut: 'ouvert', derniere_activite_le: new Date().toISOString() })
      .eq('id', ticket.id)

    if (audio) {
      const ext = (audio.type || '').includes('ogg') ? 'ogg' : 'webm'
      await sendTelegramFichierAudio(audio, `message-vocal.${ext}`, messageId ?? replyTo)
    }

    return NextResponse.json({ ok: true, notifEnvoyee: messageId !== null }, { status: 201 })
  } catch (e) {
    console.error('[api/tickets/[id]/messages POST]', e)
    await reportError('Réponse ticket (Olivier)', e)
    return NextResponse.json({ error: 'envoi_impossible' }, { status: 500 })
  }
}
