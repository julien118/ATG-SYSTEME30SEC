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
import { transcrireAudio, reponctuer } from '@/lib/transcription'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ok = () => NextResponse.json({ ok: true })

// Telecharge un vocal Telegram (file_id) et le transcrit via Whisper. Renvoie le
// texte (reponctue), ou '' en cas d'echec. Les vocaux Telegram sont en OGG/OPUS,
// directement acceptes par Whisper. Best-effort : ne throw jamais.
// Repond l'id du salon courant (aide au setup d'un groupe : on y envoie /chatid
// pour recuperer son id et router les notifications dessus). Best-effort.
async function repondreChatId(chatId: string | number): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  if (!token) return
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: `🆔 Chat ID de ce salon : ${chatId}` }),
    })
  } catch {
    // best-effort
  }
}

async function transcrireVocalTelegram(fileId: string): Promise<string> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  if (!token) return ''
  try {
    const infoRes = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
    )
    const info = await infoRes.json().catch(() => null)
    const filePath = info?.result?.file_path
    if (!filePath) return ''
    const dl = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`)
    if (!dl.ok) return ''
    const buf = new Uint8Array(await dl.arrayBuffer())
    const fichier = new File([buf], 'reponse.ogg', { type: 'audio/ogg' })
    const brut = await transcrireAudio(fichier)
    return (await reponctuer(brut)).trim()
  } catch (e) {
    await reportError('Transcription réponse vocale', e)
    return ''
  }
}

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
        voice?: { file_id?: string }
        audio?: { file_id?: string }
      }
    }
    const msg = update?.message
    if (!msg) return ok()

    // Aide au setup d'un groupe : "/chatid" depuis n'importe quel salon où le bot
    // est présent renvoie l'id du salon (pour router les notifs vers un groupe).
    // Le secret token a déjà été validé plus haut.
    if ((msg.text ?? '').trim().toLowerCase().startsWith('/chatid')) {
      await repondreChatId(msg.chat?.id ?? '')
      return ok()
    }

    const chatId = process.env.TELEGRAM_CHAT_ID?.trim()
    // 2) Garde-fous : bon chat, et c'est bien un reply.
    if (String(msg.chat?.id ?? '') !== chatId) return ok()
    const replyToId = msg.reply_to_message?.message_id
    if (!replyToId) return ok()

    // 3) Matching du ticket par le message_id du message d'origine.
    const admin = createAdminClient()
    const { data: ticket } = await admin
      .from('tickets')
      .select('id')
      .eq('telegram_message_id', replyToId)
      .maybeSingle()
    // Reply sur autre chose (une alerte, un digest) -> pas de ticket -> on ignore.
    if (!ticket) return ok()

    // 4) Reponse = texte tapé, OU vocal transcrit (Julien peut répondre à la voix ;
    //    Olivier voit toujours du texte). Vocal -> Whisper.
    let reponseTexte = (msg.text ?? '').trim()
    let estVocal = false
    const fileId = msg.voice?.file_id || msg.audio?.file_id
    if (!reponseTexte && fileId) {
      estVocal = true
      reponseTexte = await transcrireVocalTelegram(fileId)
    }
    if (!reponseTexte) return ok()

    // 5) Ecriture de la reponse + reveil de la pastille cote Olivier.
    await admin
      .from('tickets')
      .update({
        reponse: reponseTexte.slice(0, 8000),
        statut: 'repondu',
        lu_par_olivier: false,
        repondu_le: new Date().toISOString(),
      })
      .eq('id', ticket.id)

    // 6) Accuse de reception a Julien (best-effort).
    await sendTelegram(
      estVocal
        ? '✅ Réponse vocale transcrite et transmise à Olivier.'
        : '✅ Réponse transmise à Olivier.',
    )
    return ok()
  } catch (e) {
    console.error('[api/telegram-webhook]', e)
    await reportError('Webhook Telegram', e)
    // 200 quand meme : sinon Telegram retry en boucle.
    return ok()
  }
}
