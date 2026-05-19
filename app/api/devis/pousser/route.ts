// =============================================================
// POST /api/devis/pousser
// =============================================================
// Body : { devisId }
// Construit le payload Costructor depuis sections_finales,
// pousse via Costructor API, persiste l'ID + URL retournés.

import { NextResponse } from 'next/server'
import {
  calculerTotalHT,
  calculerTotalTTC,
  construirePayloadDevis,
  pousserDevis,
  supprimerDevis,
} from '@/lib/costructor'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Chantier, Devis, SectionDevis } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const { devisId } = (await request.json().catch(() => ({}))) as {
      devisId?: string
    }
    if (!devisId) {
      return NextResponse.json({ error: 'devisId manquant' }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data: devisData, error: errD } = await supabase
      .from('devis')
      .select('*')
      .eq('id', devisId)
      .single()
    if (errD || !devisData) {
      return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 })
    }
    const devis = devisData as Devis

    const { data: chantierData, error: errC } = await supabase
      .from('chantiers')
      .select('*')
      .eq('id', devis.chantier_id)
      .single()
    if (errC || !chantierData) {
      return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 })
    }
    const chantier = chantierData as Chantier

    const sections: SectionDevis[] =
      devis.sections_finales ?? devis.sections_proposees ?? []
    if (sections.length === 0) {
      return NextResponse.json({ error: 'Devis sans sections' }, { status: 400 })
    }

    const contactId = process.env.COSTRUCTOR_DEMO_CUSTOMER_ID
    if (!contactId) {
      return NextResponse.json(
        { error: 'COSTRUCTOR_DEMO_CUSTOMER_ID manquant dans .env.local' },
        { status: 500 },
      )
    }

    const total_ht = calculerTotalHT(sections)
    const total_ttc = calculerTotalTTC(total_ht)

    // Idempotence : si un devis Costructor existe déjà pour cette ligne,
    // on le supprime avant d'en créer un nouveau. Évite la pollution de
    // brouillons en doublon quand le pro clique plusieurs fois "Envoyer".
    if (devis.costructor_devis_id) {
      await supprimerDevis(devis.costructor_devis_id)
    }

    const description = `Ravalement façade ${chantier.client_nom}${
      chantier.client_adresse ? ', ' + chantier.client_adresse : ''
    }.\n\nGénéré depuis Le Système 30 Secondes par ATG.`

    const payload = construirePayloadDevis({
      contactId,
      sections,
      description,
    })

    try {
      const resp = await pousserDevis(payload)
      const url = resp.url ?? `https://app.costructor.co/quotes/${resp.id}`

      const { error: errUp } = await supabase
        .from('devis')
        .update({
          statut: 'pousse_costructor',
          total_ht,
          total_ttc,
          costructor_devis_id: resp.reference ?? resp.id,
          costructor_devis_url: url,
          pousse_le: new Date().toISOString(),
          erreur_push: null,
        })
        .eq('id', devisId)
      if (errUp) throw errUp

      return NextResponse.json({
        ok: true,
        costructor_devis_id: resp.reference ?? resp.id,
        costructor_devis_url: url,
        total_ht,
        total_ttc,
      })
    } catch (pushErr) {
      // Persiste l'erreur côté DB pour pouvoir réessayer.
      await supabase
        .from('devis')
        .update({
          statut: 'echec',
          erreur_push: (pushErr as Error).message,
        })
        .eq('id', devisId)
      throw pushErr
    }
  } catch (e) {
    console.error('[api/devis/pousser]', e)
    return NextResponse.json(
      { ok: false, error: (e as Error).message ?? 'Erreur push Costructor' },
      { status: 500 },
    )
  }
}
