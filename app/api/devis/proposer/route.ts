// =============================================================
// POST /api/devis/proposer
// =============================================================
// Body : { chantierId }
// Lit les capture_items vocaux (transcriptions) + la bibliotheque_costructor,
// appelle quote-proposer, upsert un row devis avec sections_proposees,
// retourne { devisId, sections }.

import { NextResponse } from 'next/server'
import { proposerDevis } from '@/lib/quote-proposer'
import { ATG_USER_ID } from '@/lib/atg'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ArticleBibliotheque, CaptureItem } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const { chantierId } = await request.json()
    if (!chantierId) {
      return NextResponse.json({ error: 'chantierId manquant' }, { status: 400 })
    }

    // Bypass RLS pour lire/écrire toutes les tables (mode démo, single-tenant).
    const supabase = createAdminClient()

    // Vérifie l'appartenance du chantier au user démo ATG.
    const { data: chantier, error: errC } = await supabase
      .from('chantiers')
      .select('id, user_id, client_nom')
      .eq('id', chantierId)
      .eq('user_id', ATG_USER_ID)
      .single()
    if (errC || !chantier) {
      return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 })
    }

    // Récupère les transcriptions vocales du chantier.
    const { data: captures, error: errCap } = await supabase
      .from('capture_items')
      .select('transcription, type')
      .eq('chantier_id', chantierId)
      .eq('type', 'vocal')
      .order('position', { ascending: true })
    if (errCap) throw errCap

    const transcriptions = (captures as CaptureItem[])
      .map((c) => c.transcription)
      .filter((t): t is string => Boolean(t && t.trim()))

    if (transcriptions.length === 0) {
      return NextResponse.json(
        { error: 'Aucune observation vocale sur ce chantier' },
        { status: 400 },
      )
    }

    // Récupère la bibliothèque Costructor seedée.
    const { data: biblio, error: errB } = await supabase
      .from('bibliotheque_costructor')
      .select('*')
    if (errB) throw errB

    const bibliotheque = (biblio as ArticleBibliotheque[]) ?? []
    if (bibliotheque.length === 0) {
      return NextResponse.json(
        { error: 'Bibliothèque Costructor vide en DB' },
        { status: 500 },
      )
    }

    // Appel IA.
    const sections = await proposerDevis(transcriptions, bibliotheque)

    if (sections.length === 0) {
      return NextResponse.json(
        { error: 'Aucune section produite par l\'IA (toutes filtrées)' },
        { status: 422 },
      )
    }

    // Upsert : si un devis existe déjà pour ce chantier, on le remplace.
    const { data: existant } = await supabase
      .from('devis')
      .select('id')
      .eq('chantier_id', chantierId)
      .maybeSingle()

    let devisId: string
    if (existant) {
      const { error } = await supabase
        .from('devis')
        .update({
          sections_proposees: sections,
          sections_finales: sections,
          statut: 'sections_proposees',
          total_ht: null,
          total_ttc: null,
          costructor_devis_id: null,
          costructor_devis_url: null,
          pousse_le: null,
          erreur_push: null,
        })
        .eq('id', existant.id)
      if (error) throw error
      devisId = existant.id
    } else {
      const { data: cree, error } = await supabase
        .from('devis')
        .insert({
          chantier_id: chantierId,
          sections_proposees: sections,
          sections_finales: sections,
          statut: 'sections_proposees',
        })
        .select('id')
        .single()
      if (error || !cree) throw error
      devisId = cree.id
    }

    return NextResponse.json({ devisId, sections })
  } catch (e) {
    console.error('[api/devis/proposer]', e)
    return NextResponse.json(
      { error: (e as Error).message ?? 'Erreur proposition devis' },
      { status: 500 },
    )
  }
}
