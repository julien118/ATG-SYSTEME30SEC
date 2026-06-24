// =============================================================
// GET /api/tickets/[id] — détail d'un fil de discussion
// =============================================================
// Renvoie la meta du ticket + tous ses messages (ticket_messages) triés du plus
// ancien au plus récent, pour la vue conversation. Protégé par le middleware.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ATG_USER_ID } from '@/lib/atg'
import { reportError } from '@/lib/monitoring'
import type { TicketDetail, TicketMessage, TicketStatut } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function normaliserStatut(s: string | null): TicketStatut {
  return s === 'resolu' ? 'resolu' : 'ouvert'
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const admin = createAdminClient()
    const { data: t } = await admin
      .from('tickets')
      .select('id, categorie, statut, titre, created_at')
      .eq('id', params.id)
      .eq('user_id', ATG_USER_ID)
      .maybeSingle()
    if (!t) return NextResponse.json({ error: 'introuvable' }, { status: 404 })

    const { data: msgs } = await admin
      .from('ticket_messages')
      .select('id, auteur, texte, created_at')
      .eq('ticket_id', t.id)
      .order('created_at', { ascending: true })

    const detail: TicketDetail = {
      id: t.id,
      categorie: t.categorie,
      statut: normaliserStatut(t.statut),
      titre: t.titre,
      created_at: t.created_at,
      messages: (msgs ?? []) as TicketMessage[],
    }
    return NextResponse.json(
      { ticket: detail },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    )
  } catch (e) {
    console.error('[api/tickets/[id] GET]', e)
    await reportError('Détail ticket', e)
    return NextResponse.json({ error: 'erreur' }, { status: 500 })
  }
}
