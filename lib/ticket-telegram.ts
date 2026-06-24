// =============================================================
// Formatage des messages Telegram d'un fil de discussion (tickets)
// =============================================================
// Centralise la mise en forme HTML (échappée) des notifications envoyées à Julien :
// ouverture d'une demande + réponses d'Olivier dans le fil. Réutilisé par les
// routes /api/tickets et /api/tickets/[id]/messages.

import { echapperHtml, nomDeploiement } from './notify'
import type { TicketContexte } from './types'

const fmtHorodatage = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

function appareilDepuisUA(ua?: string): string | null {
  if (!ua) return null
  if (/iphone/i.test(ua)) return 'iPhone'
  if (/ipad/i.test(ua)) return 'iPad'
  if (/android/i.test(ua)) return 'Android'
  if (/mac os x/i.test(ua)) return 'Mac'
  if (/windows/i.test(ua)) return 'Windows'
  return null
}

const FOOTER = '↩️ Réponds en "répondant" à ce message. /resolu pour clore.'

// Notification d'OUVERTURE d'une demande (1er message du fil).
export function formaterOuverture(
  titre: string | null,
  message: string,
  contexte: TicketContexte,
): string {
  const sujet = titre?.trim() ? ` — <i>${echapperHtml(titre.trim())}</i>` : ''
  const lignes = [
    `💬 <b>${echapperHtml(nomDeploiement())} — Olivier Graviou</b>${sujet}`,
    echapperHtml(message),
    '',
  ]
  if (contexte.path) lignes.push(`📍 Page : ${echapperHtml(contexte.path)}`)
  if (contexte.chantierLabel) lignes.push(`🏗️ Chantier : ${echapperHtml(contexte.chantierLabel)}`)
  const meta = [appareilDepuisUA(contexte.userAgent), contexte.viewport].filter(Boolean).join(' · ')
  if (meta) lignes.push(`📱 ${echapperHtml(meta)}`)
  lignes.push(`🕐 ${fmtHorodatage.format(new Date())}`)
  lignes.push('')
  lignes.push(FOOTER)
  return lignes.join('\n')
}

// Réponse d'OLIVIER dans un fil existant (relance).
export function formaterReponseOlivier(titre: string | null, message: string): string {
  const sujet = titre?.trim() ? ` — <i>${echapperHtml(titre.trim())}</i>` : ''
  return [
    `💬 <b>Olivier</b>${sujet}`,
    echapperHtml(message),
    '',
    FOOTER,
  ].join('\n')
}
