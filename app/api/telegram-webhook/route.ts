// =============================================================
// /api/telegram-webhook — reponses de Julien (Telegram -> app)
// =============================================================
// Telegram appelle cette route quand un message arrive dans la discussion du bot.
// On ne traite que les REPONSES (reply) a un message de ticket : on retrouve le
// ticket par message.reply_to_message.message_id == tickets.telegram_message_id,
// et on y ecrit la reponse de Julien. Olivier la voit dans "Mes demandes".
//
// Route PUBLIQUE (Telegram n'a pas le cookie de session — exemptee dans
// middleware.ts). Sa securite repose sur le secret token : Telegram renvoie
// TELEGRAM_WEBHOOK_SECRET dans l'en-tete x-telegram-bot-api-secret-token (configure
// au setWebhook). On verifie aussi que le message vient bien de TELEGRAM_CHAT_ID.
//
// On repond TOUJOURS 200 (sauf secret invalide) : un non-200 ferait re-essayer
// Telegram en boucle. Les messages non pertinents (pas un reply, pas un ticket,
// texte vide, autre chat) sont ignores proprement.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTelegram } from '@/lib/notify'
import { reportError } from '@/lib/monitoring'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ok = () => NextResponse.json({ ok: true })

export async function POST(request: Request) {
  // 1) Securite : secret token (configure au setWebhook, renvoye par Telegram).
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim()
  const recu = request.headers.get('x-telegram-bot-api-secret-token')
  if (!secret || recu !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  try {
    const update = (await request.json().catch(() => ({}))) as {
      message?: {
        text?: string
        chat?: { id?: number | string }
        reply_to_message?: { message_id?: number }
      }
    }
    const msg = update?.message
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim()

    // 2) Garde-fous : bon chat, c'est un reply, le texte n'est pas vide.
    if (!msg || String(msg.chat?.id ?? '') !== chatId) return ok()
    const replyToId = msg.reply_to_message?.message_id
    const texte = (msg.text ?? '').trim()
    if (!replyToId || !texte) return ok()

    // 3) Matching du ticket par le message_id du message d'origine.
    const admin = createAdminClient()
    const { data: ticket } = await admin
      .from('tickets')
      .select('id')
      .eq('telegram_message_id', replyToId)
      .maybeSingle()
    // Reply sur autre chose (une alerte, un digest) -> pas de ticket -> on ignore.
    if (!ticket) return ok()

    // 4) Ecriture de la reponse + reveil de la pastille cote Olivier.
    await admin
      .from('tickets')
      .update({
        reponse: texte.slice(0, 8000),
        statut: 'repondu',
        lu_par_olivier: false,
        repondu_le: new Date().toISOString(),
      })
      .eq('id', ticket.id)

    // 5) Accuse de reception a Julien (best-effort).
    await sendTelegram('✅ Réponse transmise à Olivier.')
    return ok()
  } catch (e) {
    console.error('[api/telegram-webhook]', e)
    await reportError('Webhook Telegram', e)
    // 200 quand meme : sinon Telegram retry en boucle.
    return ok()
  }
}
