// =============================================================
// /api/tickets — canal de support Olivier -> Julien
// =============================================================
// POST : Olivier envoie un message (texte seul) + un contexte auto-capture. On
//   stocke le ticket, on enrichit le contexte cote serveur (libelle du chantier),
//   puis on notifie Julien sur Telegram et on memorise le message_id retourne
//   (cle de matching des reponses, cf. /api/telegram-webhook).
// GET  : liste des demandes d'Olivier pour le panneau "Mes demandes" + compteur
//   de reponses non lues (pastille).
//
// Routes PROTEGEES par le middleware (session d'Olivier). Acces DB via le client
// admin (service_role) en filtrant explicitement par ATG_USER_ID, comme les
// autres routes du projet.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ATG_USER_ID } from '@/lib/atg'
import { sendTelegramAvecId, sendTelegramFichierAudio, echapperHtml, nomDeploiement } from '@/lib/notify'
import { reportError } from '@/lib/monitoring'
import type { TicketContexte } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fmtHorodatage = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

// Ne garde que des chaines courtes sur des cles connues : le contexte vient du
// navigateur, on ne lui fait pas confiance pour le stocker tel quel.
function nettoyerContexte(brut: unknown): TicketContexte {
  const c = (brut ?? {}) as Record<string, unknown>
  const str = (v: unknown, max: number): string | undefined => {
    const s = typeof v === 'string' ? v.trim() : ''
    return s ? s.slice(0, max) : undefined
  }
  const out: TicketContexte = {}
  const path = str(c.path, 200)
  const chantierId = str(c.chantierId, 36)
  const viewport = str(c.viewport, 20)
  const userAgent = str(c.userAgent, 200)
  if (path) out.path = path
  if (chantierId && UUID_RE.test(chantierId)) out.chantierId = chantierId
  if (viewport) out.viewport = viewport
  if (userAgent) out.userAgent = userAgent
  return out
}

function appareilDepuisUA(ua?: string): string | null {
  if (!ua) return null
  if (/iphone/i.test(ua)) return 'iPhone'
  if (/ipad/i.test(ua)) return 'iPad'
  if (/android/i.test(ua)) return 'Android'
  if (/mac os x/i.test(ua)) return 'Mac'
  if (/windows/i.test(ua)) return 'Windows'
  return null
}

function formaterNotifTicket(message: string, ctx: TicketContexte): string {
  const lignes = [
    `💬 <b>${echapperHtml(nomDeploiement())}</b> — nouveau message`,
    echapperHtml(message),
    '',
  ]
  if (ctx.path) lignes.push(`📍 Page : ${echapperHtml(ctx.path)}`)
  if (ctx.chantierLabel) lignes.push(`🏗️ Chantier : ${echapperHtml(ctx.chantierLabel)}`)
  const appareil = appareilDepuisUA(ctx.userAgent)
  const meta = [appareil, ctx.viewport].filter(Boolean).join(' · ')
  if (meta) lignes.push(`📱 ${echapperHtml(meta)}`)
  lignes.push(`🕐 ${fmtHorodatage.format(new Date())}`)
  lignes.push('')
  lignes.push('↩️ Réponds en "répondant" à ce message.')
  return lignes.join('\n')
}

export async function POST(request: Request) {
  try {
    // Deux formats acceptes : JSON (texte seul) ou multipart/form-data quand un
    // vocal est joint (champs message + contexte + audio).
    const ct = request.headers.get('content-type') || ''
    let messageRaw = ''
    let contexteRaw: unknown = {}
    let audioFile: Blob | null = null
    if (ct.includes('multipart/form-data')) {
      const form = await request.formData()
      messageRaw = String(form.get('message') ?? '')
      try {
        contexteRaw = JSON.parse(String(form.get('contexte') ?? '{}'))
      } catch {
        contexteRaw = {}
      }
      const a = form.get('audio')
      if (a instanceof Blob && a.size > 0) audioFile = a
    } else {
      const body = (await request.json().catch(() => ({}))) as {
        message?: unknown
        contexte?: unknown
      }
      messageRaw = String(body.message ?? '')
      contexteRaw = body.contexte
    }

    let message = messageRaw.trim().slice(0, 4000)
    // Vocal sans texte (transcription vide/echouee) : on garde un libelle parlant.
    if (!message && audioFile) message = '🎤 Message vocal'
    if (!message) {
      return NextResponse.json({ error: 'message_vide' }, { status: 400 })
    }

    const contexte = nettoyerContexte(contexteRaw)
    const admin = createAdminClient()

    // Enrichissement serveur : le navigateur n'a que l'id du chantier (dans l'URL),
    // pas le libelle. On le resout ici pour la notif + l'affichage.
    if (contexte.chantierId) {
      const { data: chantier } = await admin
        .from('chantiers')
        .select('client_nom')
        .eq('id', contexte.chantierId)
        .eq('user_id', ATG_USER_ID)
        .maybeSingle()
      if (chantier?.client_nom) contexte.chantierLabel = chantier.client_nom
    }

    const { data: ticket, error } = await admin
      .from('tickets')
      .insert({
        user_id: ATG_USER_ID,
        chantier_id: contexte.chantierId ?? null,
        message,
        contexte,
      })
      .select('id, created_at, message, contexte, statut, reponse, repondu_le, lu_par_olivier, chantier_id')
      .single()

    if (error || !ticket) {
      await reportError('Création ticket', error)
      return NextResponse.json({ error: 'creation_impossible' }, { status: 500 })
    }

    // Notif Telegram + memorisation du message_id (cle de matching des reponses).
    const messageId = await sendTelegramAvecId(formaterNotifTicket(message, contexte))
    if (messageId !== null) {
      await admin.from('tickets').update({ telegram_message_id: messageId }).eq('id', ticket.id)
    }

    // Vocal d'Olivier joint -> on l'envoie aussi sur Telegram (en reponse au message
    // du ticket pour le rattacher). Best-effort : ne bloque jamais la reponse.
    if (audioFile) {
      await sendTelegramFichierAudio(audioFile, 'message-vocal.webm', messageId ?? undefined)
    }

    return NextResponse.json(
      { ok: true, ticket, notifEnvoyee: messageId !== null },
      { status: 201 },
    )
  } catch (e) {
    console.error('[api/tickets POST]', e)
    await reportError('Création ticket', e)
    return NextResponse.json({ error: 'creation_impossible' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const admin = createAdminClient()
    const { data: tickets } = await admin
      .from('tickets')
      .select('id, created_at, message, contexte, statut, reponse, repondu_le, lu_par_olivier, chantier_id')
      .eq('user_id', ATG_USER_ID)
      .order('created_at', { ascending: false })
      .limit(50)

    const liste = tickets ?? []
    const nonLus = liste.filter((t) => t.statut === 'repondu' && !t.lu_par_olivier).length
    return NextResponse.json({ tickets: liste, nonLus })
  } catch (e) {
    console.error('[api/tickets GET]', e)
    await reportError('Liste tickets', e)
    return NextResponse.json({ tickets: [], nonLus: 0 }, { status: 500 })
  }
}
