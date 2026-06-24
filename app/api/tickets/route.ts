// =============================================================
// /api/tickets — fils de discussion support Olivier <-> Julien
// =============================================================
// POST : Olivier ouvre une demande (texte + vocal OGG optionnel). On analyse
//   (catégorie + titre IA), on crée le ticket + le 1er message du fil, on notifie
//   Julien sur Telegram (en mémorisant le message_id pour matcher ses réponses),
//   et on lui transmet le vocal (bulle vocale native si OGG).
// GET  : liste compacte (cartes) pour "Mes demandes" : titre/aperçu, état, rubrique,
//   non-lu, dernière activité, nb d'échanges. + compteur nonLus.
//
// Protégé par le middleware. Accès DB via le client admin, filtré par ATG_USER_ID.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ATG_USER_ID } from '@/lib/atg'
import { sendTelegramAvecId, sendTelegramFichierAudio } from '@/lib/notify'
import { formaterOuverture } from '@/lib/ticket-telegram'
import { analyserMessage } from '@/lib/ticket-classifier'
import { reportError } from '@/lib/monitoring'
import type { TicketContexte, TicketResume, TicketStatut } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

function normaliserStatut(s: string | null): TicketStatut {
  return s === 'resolu' ? 'resolu' : 'ouvert'
}

// Lecture commune JSON / multipart (message + contexte + audio).
async function lireCorps(
  request: Request,
): Promise<{ message: string; contexte: unknown; audio: Blob | null }> {
  const ct = request.headers.get('content-type') || ''
  if (ct.includes('multipart/form-data')) {
    const form = await request.formData()
    let contexte: unknown = {}
    try {
      contexte = JSON.parse(String(form.get('contexte') ?? '{}'))
    } catch {
      contexte = {}
    }
    const a = form.get('audio')
    return {
      message: String(form.get('message') ?? ''),
      contexte,
      audio: a instanceof Blob && a.size > 0 ? a : null,
    }
  }
  const body = (await request.json().catch(() => ({}))) as { message?: unknown; contexte?: unknown }
  return { message: String(body.message ?? ''), contexte: body.contexte, audio: null }
}

export async function POST(request: Request) {
  try {
    const { message: messageRaw, contexte: contexteRaw, audio } = await lireCorps(request)
    let message = messageRaw.trim().slice(0, 4000)
    if (!message && audio) message = '🎤 Message vocal'
    if (!message) return NextResponse.json({ error: 'message_vide' }, { status: 400 })

    const contexte = nettoyerContexte(contexteRaw)
    const admin = createAdminClient()

    // Libellé du chantier courant (le client n'a que l'id).
    if (contexte.chantierId) {
      const { data: chantier } = await admin
        .from('chantiers')
        .select('client_nom')
        .eq('id', contexte.chantierId)
        .eq('user_id', ATG_USER_ID)
        .maybeSingle()
      if (chantier?.client_nom) contexte.chantierLabel = chantier.client_nom
    }

    // Analyse IA : rubrique + titre court (best-effort).
    const { categorie, titre } = await analyserMessage(message)
    const nowIso = new Date().toISOString()

    const { data: ticket, error } = await admin
      .from('tickets')
      .insert({
        user_id: ATG_USER_ID,
        chantier_id: contexte.chantierId ?? null,
        message,
        contexte,
        categorie,
        titre: titre || null,
        statut: 'ouvert',
        derniere_activite_le: nowIso,
      })
      .select('id')
      .single()
    if (error || !ticket) {
      await reportError('Création ticket', error)
      return NextResponse.json({ error: 'creation_impossible' }, { status: 500 })
    }

    // Notif Telegram (avec titre) + mémorisation du message_id sur le 1er message du fil.
    const messageId = await sendTelegramAvecId(formaterOuverture(titre || null, message, contexte))
    await admin.from('ticket_messages').insert({
      ticket_id: ticket.id,
      auteur: 'olivier',
      texte: message,
      telegram_message_id: messageId,
    })

    // Vocal d'Olivier -> Telegram (bulle vocale si OGG ; sinon fichier).
    if (audio) {
      const ext = (audio.type || '').includes('ogg') ? 'ogg' : 'webm'
      await sendTelegramFichierAudio(audio, `message-vocal.${ext}`, messageId ?? undefined)
    }

    return NextResponse.json(
      { ok: true, id: ticket.id, notifEnvoyee: messageId !== null },
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
    const { data: tks } = await admin
      .from('tickets')
      .select('id, categorie, statut, titre, message, lu_par_olivier, derniere_activite_le, created_at')
      .eq('user_id', ATG_USER_ID)
      .order('derniere_activite_le', { ascending: false, nullsFirst: false })
      .limit(80)

    const tickets = tks ?? []
    const ids = tickets.map((t) => t.id)

    // Agrégat des messages par fil (nombre + dernier auteur).
    const agg = new Map<string, { nb: number; last: string; auteur: 'olivier' | 'julien' }>()
    if (ids.length) {
      const { data: msgs } = await admin
        .from('ticket_messages')
        .select('ticket_id, auteur, created_at')
        .in('ticket_id', ids)
      for (const m of msgs ?? []) {
        const e = agg.get(m.ticket_id)
        if (!e) {
          agg.set(m.ticket_id, { nb: 1, last: m.created_at, auteur: m.auteur })
        } else {
          e.nb += 1
          if (m.created_at > e.last) {
            e.last = m.created_at
            e.auteur = m.auteur
          }
        }
      }
    }

    const resumes: TicketResume[] = tickets.map((t) => {
      const a = agg.get(t.id)
      const apercu = t.titre?.trim() ? t.titre.trim() : (t.message ?? '').slice(0, 90)
      return {
        id: t.id,
        categorie: t.categorie,
        statut: normaliserStatut(t.statut),
        titre: t.titre,
        apercu,
        lu_par_olivier: t.lu_par_olivier,
        derniere_activite_le: t.derniere_activite_le ?? t.created_at,
        nb_messages: a?.nb ?? 0,
        dernier_auteur: a?.auteur ?? null,
      }
    })
    const nonLus = tickets.filter((t) => !t.lu_par_olivier).length
    return NextResponse.json(
      { tickets: resumes, nonLus },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    )
  } catch (e) {
    console.error('[api/tickets GET]', e)
    await reportError('Liste tickets', e)
    return NextResponse.json({ tickets: [], nonLus: 0 }, { status: 500 })
  }
}
