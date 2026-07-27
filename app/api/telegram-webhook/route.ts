// =============================================================
// /api/telegram-webhook — Julien pilote le support depuis Telegram (Telegram -> app)
// =============================================================
// Telegram appelle cette route quand un message arrive dans la discussion du bot.
// Julien peut, depuis Telegram :
//   • /nouveau           -> mode GUIDÉ : le bot pose la question (force_reply), la
//                           réponse de Julien devient la demande (titre + catégorie IA).
//                           Raccourci : /nouveau <texte> crée directement.
//   • /repondre          -> mode GUIDÉ idem, mais la réponse va sur la demande la PLUS
//                           RÉCENTE. Raccourci : /repondre <texte>.
//   • répondre (reply) à un message du bot -> écrire dans CE ticket précis (+ /resolu
//                           pour le clore). Comportement historique inchangé.
// Le mode guidé est SANS ÉTAT : le bot pose sa question via force_reply, et on
// reconnaît la réponse de Julien au TEXTE du message cité (reply_to_message.text).
// Un message SIMPLE (ni commande, ni reply) est IGNORÉ : rien ne part vers Olivier
// par accident. Olivier voit tout dans "Mes demandes" (pastille non-lu).
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
import { ATG_USER_ID } from '@/lib/atg'
import { sendTelegram, sendTelegramForceReply } from '@/lib/notify'
import { analyserMessage } from '@/lib/ticket-classifier'
import { reportError } from '@/lib/monitoring'
import { transcrireAudio, nettoyerDictee } from '@/lib/transcription'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ok = () => NextResponse.json({ ok: true })

// Questions du mode guidé. On RECONNAÎT ensuite la réponse de Julien au fait que
// reply_to_message.text COMMENCE par l'un de ces marqueurs (Telegram renvoie le
// texte rendu, sans balises HTML). Les marqueurs doivent donc rester stables.
const PROMPT_NOUVEAU = '📝 Nouvelle demande'
const PROMPT_REPONDRE = '✍️ Réponse à ta dernière demande'
const QUESTION_NOUVEAU = `${PROMPT_NOUVEAU} — écris ton message pour Olivier (texte ou vocal). Le titre et la catégorie seront ajoutés automatiquement.`
const QUESTION_REPONDRE = `${PROMPT_REPONDRE} — écris ta réponse (texte ou vocal). Elle ira sur ta demande la plus récente.`

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

// Julien OUVRE une nouvelle demande depuis Telegram (/nouveau <texte>). On
// reproduit la création côté Olivier (analyse IA titre+catégorie, ticket + 1er
// message), mais avec auteur='julien' et lu_par_olivier=false pour que la pastille
// s'allume chez Olivier. Pas de telegram_message_id sur le 1er message : il n'y a
// pas de message du bot à threader ; la prochaine réponse d'Olivier créera le fil
// Telegram normalement. Renvoie {titre} si créé (titre éventuellement null), ou
// null si la création a échoué (pour un accusé honnête).
async function creerDemandeDepuisJulien(
  corps: string,
): Promise<{ titre: string | null } | null> {
  const admin = createAdminClient()
  const { categorie, titre } = await analyserMessage(corps)
  const nowIso = new Date().toISOString()
  const { data: ticket, error } = await admin
    .from('tickets')
    .insert({
      user_id: ATG_USER_ID,
      chantier_id: null,
      message: corps,
      contexte: {},
      categorie,
      titre: titre || null,
      statut: 'ouvert',
      lu_par_olivier: false,
      derniere_activite_le: nowIso,
    })
    .select('id')
    .single()
  if (error || !ticket) {
    await reportError('Création demande via Telegram', error)
    return null
  }
  await admin.from('ticket_messages').insert({
    ticket_id: ticket.id,
    auteur: 'julien',
    texte: corps.slice(0, 8000),
  })
  return { titre: titre || null }
}

// Julien RÉPOND à la demande la plus récente (/repondre <texte>), sans reply. On
// ajoute le message au fil et on rallume la pastille. Renvoie {titre} de la demande
// touchée, ou null s'il n'existe aucune demande.
async function repondreDerniereDemande(
  corps: string,
): Promise<{ titre: string | null } | null> {
  const admin = createAdminClient()
  const { data: dernier } = await admin
    .from('tickets')
    .select('id, titre')
    .eq('user_id', ATG_USER_ID)
    .order('derniere_activite_le', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (!dernier) return null
  const nowIso = new Date().toISOString()
  await admin.from('ticket_messages').insert({
    ticket_id: dernier.id,
    auteur: 'julien',
    texte: corps.slice(0, 8000),
  })
  await admin
    .from('tickets')
    .update({ statut: 'ouvert', lu_par_olivier: false, derniere_activite_le: nowIso })
    .eq('id', dernier.id)
  return { titre: dernier.titre ?? null }
}

// Crée la demande à partir du corps saisi et envoie l'accusé à Julien. Partagé
// par le raccourci (/nouveau <texte>) et le mode guidé (réponse à la question).
async function traiterNouveau(corps: string): Promise<void> {
  const res = await creerDemandeDepuisJulien(corps)
  await sendTelegram(
    !res
      ? '❌ Création impossible (réessaie dans un instant).'
      : res.titre
        ? `✅ Nouvelle demande créée : « ${res.titre} » — transmise à Olivier.`
        : '✅ Nouvelle demande créée et transmise à Olivier.',
  )
}

// Ajoute la réponse à la demande la plus récente et envoie l'accusé à Julien.
async function traiterRepondre(corps: string): Promise<void> {
  const res = await repondreDerniereDemande(corps)
  await sendTelegram(
    !res
      ? 'ℹ️ Aucune demande en cours. Ouvre-en une avec /nouveau.'
      : res.titre
        ? `✅ Réponse transmise à Olivier (demande « ${res.titre} »).`
        : '✅ Réponse transmise à Olivier.',
  )
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
        reply_to_message?: { message_id?: number; text?: string }
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
    // 2) Garde-fou : le message vient bien du bon salon.
    if (String(msg.chat?.id ?? '') !== chatId) return ok()

    const texteMsg = (msg.text ?? '').trim()

    // Corps saisi = texte tapé, ou vocal Telegram transcrit (Julien peut dicter).
    const fileIdEntrant = msg.voice?.file_id || msg.audio?.file_id
    const corpsSaisi = async (texte: string): Promise<{ texte: string; vocal: boolean }> => {
      if (texte) return { texte, vocal: false }
      if (fileIdEntrant) return { texte: (await transcrireVocalTelegram(fileIdEntrant)).trim(), vocal: true }
      return { texte: '', vocal: false }
    }

    // 2a) Réponse au mode GUIDÉ : Julien répond à une question du bot (force_reply).
    //     On reconnaît la question au texte cité. Traité AVANT le matching ticket.
    const texteCite = msg.reply_to_message?.text ?? ''
    if (texteCite.startsWith(PROMPT_NOUVEAU) || texteCite.startsWith(PROMPT_REPONDRE)) {
      const { texte: corps } = await corpsSaisi(texteMsg)
      if (!corps) {
        await sendTelegram('ℹ️ Je n’ai rien reçu. Relance avec /nouveau ou /repondre.')
        return ok()
      }
      if (texteCite.startsWith(PROMPT_NOUVEAU)) await traiterNouveau(corps)
      else await traiterRepondre(corps)
      return ok()
    }

    // 2b) /nouveau : mode guidé (question) si rien après, sinon raccourci direct.
    const mNouveau = texteMsg.match(/^\/(nouveau|nouvelle|new|demande)\b\s*([\s\S]*)$/i)
    if (mNouveau) {
      const corps = mNouveau[2].trim()
      if (!corps) await sendTelegramForceReply(QUESTION_NOUVEAU)
      else await traiterNouveau(corps)
      return ok()
    }

    // 2c) /repondre : mode guidé si rien après, sinon raccourci direct.
    const mRepondre = texteMsg.match(/^\/(repondre|reponse|rep)\b\s*([\s\S]*)$/i)
    if (mRepondre) {
      const corps = mRepondre[2].trim()
      if (!corps) await sendTelegramForceReply(QUESTION_REPONDRE)
      else await traiterRepondre(corps)
      return ok()
    }

    // 3) Sinon : on ne traite que les RÉPONSES (reply) à un message de ticket.
    //    Un message simple sans commande est ignoré (rien ne part par accident).
    const replyToId = msg.reply_to_message?.message_id
    if (!replyToId) return ok()

    // 4) Matching du ticket par le message_id du message d'origine (cherché dans le
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

    // 5) Commande de clôture : "/resolu" (ou /ferme) en réponse à un message du fil.
    const texteReply = (msg.text ?? '').trim()
    if (/^\/(resolu|resolue|ferme|close)\b/i.test(texteReply)) {
      await admin
        .from('tickets')
        .update({ statut: 'resolu', derniere_activite_le: nowIso })
        .eq('id', ticketId)
      await sendTelegram('✅ Demande marquée comme résolue.')
      return ok()
    }

    // 6) Réponse = texte tapé, OU vocal transcrit (Julien répond à la voix ; Olivier
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

    // 7) Accuse de reception a Julien (best-effort).
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
