// Pose (ou met a jour) le webhook Telegram qui recoit les reponses de Julien
// aux tickets d'Olivier -> /api/telegram-webhook.
//
// Lancer :
//   npx tsx --env-file=.env.local scripts/setup-telegram-webhook.mts <URL_BASE>
//   ex : npx tsx --env-file=.env.local scripts/setup-telegram-webhook.mts https://atg-xxx.vercel.app
//
// Variables d'env lues : TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET.
// Le secret DOIT etre identique a celui configure sur Vercel (la route le verifie
// dans l'en-tete x-telegram-bot-api-secret-token, sinon 401).
//
// ATTENTION : un bot n'a qu'UN webhook actif a la fois. Le poser sur une preview
// le retire de la prod (et inversement). Les notifs SORTANTES (alertes, digests,
// tickets) ne dependent pas du webhook et ne sont pas affectees.
//
// Pour retirer le webhook (rollback) : appeler deleteWebhook (cf. doc Telegram) ou
// relancer ce script vers l'URL voulue.

const token = process.env.TELEGRAM_BOT_TOKEN
const secret = process.env.TELEGRAM_WEBHOOK_SECRET
const base = process.argv[2]

if (!token || !secret || !base) {
  console.error(
    'Usage : npx tsx --env-file=.env.local scripts/setup-telegram-webhook.mts <URL_BASE>\n' +
      'Requis : TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET (dans .env.local) + URL_BASE en argument.',
  )
  process.exit(1)
}

const url = `${base.replace(/\/$/, '')}/api/telegram-webhook`

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url,
    secret_token: secret,
    // On ne veut que les messages (pas les edits, channel posts, etc.).
    allowed_updates: ['message'],
    // Ignore les updates en attente (evite de rejouer un vieux backlog).
    drop_pending_updates: true,
  }),
})
const setResult = await res.json().catch(() => null)
console.log('setWebhook ->', JSON.stringify(setResult, null, 2))

const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)
const infoResult = await info.json().catch(() => null)
console.log('getWebhookInfo ->', JSON.stringify(infoResult, null, 2))

if (!setResult?.ok) {
  console.error('\nEchec : le webhook n’a pas ete pose. Verifie le token et l’URL.')
  process.exit(1)
}
console.log(`\nWebhook actif sur ${url}`)
