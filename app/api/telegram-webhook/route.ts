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
import { transcrireAudio, nettoyerDictee } from '@/lib/transcription'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ok = () => NextResponse.json({ ok: true })

// Repond l'id du salon courant (aide au setup d'un groupe : "/chatid" -> id du
// salon, pour router les notifications vers un groupe). Best-effort.
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

// Telecharge un vocal Telegram (file_id) et le transcrit (Whisper) en NETTOYANT les
// mots parasites (contexte support). Renvoie le texte, ou '' en cas d'echec. Les
// vocaux Telegram sont en OGG/OPUS, acceptes par Whisper. Best-effort : ne throw jamais.
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
    return (await nettoyerDictee(brut)).trim()
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

    // 3) Matching du ticket par le message_id du message d'origine (cherché dans le
    //    fil ticket_messages). Reply sur autre chose (alerte/digest) -> on ignore.
    const admin = createAdminClient()
    const { data: mm } = await admin
      .from('ticket_messages')
      .select('ticket_id')
      .eq('telegram_message_id', replyToId)
      .maybeSingle()
    if (!mm) return ok()
    const ticketId = mm.ticket_id as string
    const nowIso = new Date().toISOString()

    // 4) Commande de clôture : "/resolu" (ou /ferme) en réponse à un message du fil.
    const texteReply = (msg.text ?? '').trim()
    if (/^\/(resolu|resolue|ferme|close)\b/i.test(texteReply)) {
      await admin
        .from('tickets')
        .update({ statut: 'resolu', derniere_activite_le: nowIso })
        .eq('id', ticketId)
      await sendTelegram('✅ Demande marquée comme résolue.')
      return ok()
    }

    // 5) Réponse = texte tapé, OU vocal transcrit (Julien répond à la voix ; Olivier
    //    voit toujours du texte, nettoyé). On AJOUTE au fil (pas d'écrasement).
    let reponseTexte = texteReply
    let estVocal = false
    const fileId = msg.voice?.file_id || msg.audio?.file_id
    if (!reponseTexte && fileId) {
      estVocal = true
      reponseTexte = await transcrireVocalTelegram(fileId)
    }
    if (!reponseTexte) return ok()

    await admin.from('ticket_messages').insert({
      ticket_id: ticketId,
      auteur: 'julien',
      texte: reponseTexte.slice(0, 8000),
    })
    // Le fil redevient ouvert (relance) + remonte + pastille non-lu côté Olivier.
    await admin
      .from('tickets')
      .update({ statut: 'ouvert', lu_par_olivier: false, derniere_activite_le: nowIso })
      .eq('id', ticketId)

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
