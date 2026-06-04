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
  construireNomDevis,
  construirePayloadDevis,
  pousserDevis,
  supprimerDevis,
  trouverOuCreerContact,
} from '@/lib/costructor'
import { composerDescriptionAvecRapport } from '@/lib/rapport-pdf'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Chantier, Devis, SectionDevis } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const { devisId, mode } = (await request.json().catch(() => ({}))) as {
      devisId?: string
      // 'remplacer' (defaut) : comportement actuel (supprime l'ancien devis
      // Costructor avant de recreer). 'copie' (point 13) : on NE supprime PAS
      // l'ancien, on cree le nouveau a cote (Olivier garde l'ancienne version).
      mode?: 'remplacer' | 'copie'
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

    // Rapprochement client : on cherche le contact existant par email > téléphone > nom,
    // sinon on en crée un. Ça remplace l'attribution à un contact démo hardcodé.
    if (!chantier.client_nom?.trim()) {
      return NextResponse.json(
        { error: 'Chantier sans client_nom : impossible de matcher un contact Costructor' },
        { status: 400 },
      )
    }
    const matchContact = await trouverOuCreerContact({
      client_nom: chantier.client_nom,
      client_email: chantier.client_email,
      client_telephone: chantier.client_telephone,
      client_adresse: chantier.client_adresse,
    })
    const contactId = matchContact.contactId
    console.log(
      `[api/devis/pousser] contact ${matchContact.matchType} : ${contactId} pour "${chantier.client_nom}"`,
    )

    // Taux de TVA choisi par le pro sur l'ecran recap (lot 5.2). Defaut 10 %.
    const tvaTaux = devis.tva_taux ?? 10
    const total_ht = calculerTotalHT(sections)
    const total_ttc = calculerTotalTTC(total_ht, tvaTaux)

    // Idempotence (mode 'remplacer', defaut) : si un devis Costructor existe déjà
    // pour cette ligne, on le supprime avant d'en créer un nouveau. Évite la
    // pollution de brouillons en doublon quand le pro clique plusieurs fois.
    // Mode 'copie' (point 13) : on SAUTE cette suppression -> l'ancien devis reste
    // sur Costructor et la nouvelle version est créée à côté. La ligne devis sera
    // ensuite réécrite avec l'id du NOUVEAU (l'app suit le plus récent ; l'ancien
    // reste dans Costructor, non tracé par l'app, c'est voulu).
    if (mode !== 'copie' && devis.costructor_devis_id) {
      await supprimerDevis(devis.costructor_devis_id)
    }

    // Lot 6.1 : plus de mention « Généré depuis Le Système 30 Secondes par ATG ».
    const descriptionBase = `Ravalement façade ${chantier.client_nom}${
      chantier.client_adresse ? ', ' + chantier.client_adresse : ''
    }.`

    // Étape 2 (Phase G) : on intègre le lien du PDF de compte rendu du chantier
    // dans la description (workaround R2). Sans PDF persisté, description inchangée.
    const description = await composerDescriptionAvecRapport(
      descriptionBase,
      chantier.id,
    )

    // Lot 6.1 : nom parlant depuis l'objet des travaux dicte.
    const name = construireNomDevis(chantier.objet_travaux, chantier.client_nom)
    // Lot 6.2 : visite prealable = date de la visite technique, tronquee au jour.
    const preVisitAt = chantier.date_visite
      ? chantier.date_visite.slice(0, 10)
      : undefined

    const payload = construirePayloadDevis({
      contactId,
      sections,
      description,
      tvaTaux,
      name,
      preVisitAt,
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
