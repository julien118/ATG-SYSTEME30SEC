// =============================================================
// Canaux de notification (surveillance & reporting)
// =============================================================
// Envoi des messages d'alerte / digests sur Telegram (+ webhook generique
// optionnel). REGLE D'OR : best-effort, AUCUNE fonction ne throw — la
// surveillance ne doit jamais casser l'app ni bloquer l'utilisateur.
//
// Le token du bot Telegram ne vit QUE cote serveur (process.env). Il ne doit
// jamais transiter par le navigateur : les crashs client passent par
// /api/client-error, qui appelle reportError cote serveur.
//
// Differenciation multi-client par DEPLOYMENT_NAME (mis en tete de chaque
// message) : le meme bot peut servir plusieurs projets.

const TELEGRAM_API = 'https://api.telegram.org'
const TIMEOUT_ENVOI_MS = 5000

/** Nom affiche en tete des messages (ex. « ATG — Olivier Graviou »). */
export function nomDeploiement(): string {
  return process.env.DEPLOYMENT_NAME?.trim() || 'ATG — Olivier Graviou'
}

/** Echappe le texte dynamique pour parse_mode HTML de Telegram (& < >). */
export function echapperHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function fetchAvecTimeout(url: string, init: RequestInit): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_ENVOI_MS)
  try {
    await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

/** Envoi Telegram (HTML, gras `<b>`). No-op si les variables manquent. */
export async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim()
  if (!token || !chatId) return
  try {
    await fetchAvecTimeout(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })
  } catch {
    // best-effort : on n'alerte pas sur un echec d'alerte.
  }
}

/**
 * Variante de sendTelegram qui RENVOIE le message_id du message poste (pour
 * matcher ensuite les reponses de Julien via reply_to_message). Renvoie null si
 * non configure, si l'envoi echoue, ou si la reponse n'a pas la forme attendue
 * ({ ok:true, result:{ message_id } }). Best-effort : ne throw JAMAIS (l'appelant
 * — creation de ticket — ne doit pas casser si Telegram est indisponible ; il
 * tient compte du null pour prevenir Olivier).
 */
export async function sendTelegramAvecId(
  text: string,
  replyToMessageId?: number,
): Promise<number | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim()
  if (!token || !chatId) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_ENVOI_MS)
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      }),
      signal: controller.signal,
      cache: 'no-store',
    })
    const data = await res.json().catch(() => null)
    const id = data?.result?.message_id
    return typeof id === 'number' ? id : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Envoie un fichier audio (le vocal d'Olivier) sur Telegram, en reponse au message
 * du ticket (`replyToMessageId`) pour le rattacher visuellement. OGG/OPUS -> message
 * vocal natif (sendVoice) ; tout autre format (webm/mp4...) -> document audio jouable
 * (sendDocument), car Telegram n'accepte le vocal natif qu'en OGG/OPUS. Best-effort :
 * ne throw JAMAIS (la creation de ticket ne doit pas casser si Telegram refuse).
 */
export async function sendTelegramFichierAudio(
  file: Blob,
  filename: string,
  replyToMessageId?: number,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim()
  if (!token || !chatId) return
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const isOgg = /ogg/i.test(file.type || '')
    const method = isOgg ? 'sendVoice' : 'sendDocument'
    const field = isOgg ? 'voice' : 'document'
    const form = new FormData()
    form.append('chat_id', chatId)
    if (replyToMessageId) form.append('reply_to_message_id', String(replyToMessageId))
    if (!isOgg) form.append('caption', "🎤 Message vocal d'Olivier")
    form.append(field, file, filename)
    await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    })
  } catch {
    // best-effort : on n'alerte pas sur un echec d'envoi de vocal.
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Webhook generique optionnel (n8n / Slack / Discord). No-op si ALERT_WEBHOOK_URL
 * n'est pas defini. Le corps porte `text` (Slack), `content` (Discord) + meta.
 */
export async function sendWebhook(payload: { text: string; [k: string]: unknown }): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL?.trim()
  if (!url) return
  try {
    await fetchAvecTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, content: payload.text }),
    })
  } catch {
    // best-effort
  }
}

/** Envoie sur TOUS les canaux configures. Ne throw jamais. */
export async function notify(message: { text: string; [k: string]: unknown }): Promise<void> {
  await Promise.allSettled([sendTelegram(message.text), sendWebhook(message)])
}
