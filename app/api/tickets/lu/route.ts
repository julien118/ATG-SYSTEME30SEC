// =============================================================
// /api/tickets/lu — marquer les reponses comme lues
// =============================================================
// Appelee quand Olivier ouvre la vue "Mes demandes". Repasse toutes ses reponses
// non lues a `lu_par_olivier = true` (eteint la pastille). Route dediee pour que
// le GET /api/tickets reste pur (sans effet de bord). Protegee par le middleware.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ATG_USER_ID } from '@/lib/atg'
import { reportError } from '@/lib/monitoring'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { id?: unknown }
    const id = typeof body.id === 'string' ? body.id : null
    const admin = createAdminClient()
    let q = admin
      .from('tickets')
      .update({ lu_par_olivier: true })
      .eq('user_id', ATG_USER_ID)
      .eq('lu_par_olivier', false)
    // Avec un id : on marque ce fil précis lu (à l'ouverture de la conversation) ;
    // sans id : on marque tout lu (ouverture de la liste).
    if (id) q = q.eq('id', id)
    await q
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[api/tickets/lu POST]', e)
    await reportError('Marquage tickets lus', e)
    // Best-effort : un echec de marquage ne doit pas perturber l'affichage.
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
