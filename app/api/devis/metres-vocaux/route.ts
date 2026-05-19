// =============================================================
// POST /api/devis/metres-vocaux
// =============================================================
// Multipart : { devisId, audio? (File), sections? (JSON string) }
//
// Deux modes :
//  1. Audio fourni → Whisper transcrit, Claude parse, applique updates,
//     persiste sections_finales + totaux, retourne JSON.
//  2. Pas d'audio → sauvegarde simple des sections envoyées (édition manuelle).

import { NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { parserMetres, appliquerUpdates } from '@/lib/metrics-parser'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Devis, SectionDevis } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const fd = await request.formData()
    const devisId = fd.get('devisId')
    if (typeof devisId !== 'string' || !devisId) {
      return NextResponse.json({ error: 'devisId manquant' }, { status: 400 })
    }

    const audio = fd.get('audio')
    const sectionsBrutes = fd.get('sections')

    const supabase = createAdminClient()

    const { data: devis, error } = await supabase
      .from('devis')
      .select('*')
      .eq('id', devisId)
      .single()
    if (error || !devis) {
      return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 })
    }

    const d = devis as Devis

    // Sections de base : payload client si présent, sinon DB.
    let sectionsBase: SectionDevis[] =
      d.sections_finales ?? d.sections_proposees ?? []
    if (typeof sectionsBrutes === 'string') {
      try {
        const parsed = JSON.parse(sectionsBrutes) as SectionDevis[]
        if (Array.isArray(parsed)) sectionsBase = parsed
      } catch {
        // ignore JSON invalide
      }
    }

    let sectionsFinales = sectionsBase
    let total_ht = 0
    let total_ttc = 0
    let transcription: string | null = null

    if (audio instanceof File && audio.size > 0) {
      // Mode parse : Whisper + Claude.
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 25000)
      const t = await groq.audio.transcriptions.create(
        {
          file: audio,
          model: 'whisper-large-v3-turbo',
          language: 'fr',
          response_format: 'json',
        },
        { signal: controller.signal },
      )
      clearTimeout(timer)
      transcription = t.text

      const result = await parserMetres(transcription, sectionsBase)
      const applique = appliquerUpdates(sectionsBase, result)
      sectionsFinales = applique.sections
      total_ht = applique.total_ht
      total_ttc = applique.total_ttc
    } else {
      // Mode save : recalcule juste les totaux à partir des sections envoyées.
      total_ht = sectionsBase.reduce(
        (acc, s) =>
          acc +
          s.articles.reduce(
            (sa, a) => sa + (a.quantite ?? 0) * a.prix_vente,
            0,
          ),
        0,
      )
      total_ht = Math.round(total_ht * 100) / 100
      total_ttc = Math.round(total_ht * 1.1 * 100) / 100
    }

    const { error: errUp } = await supabase
      .from('devis')
      .update({
        sections_finales: sectionsFinales,
        total_ht,
        total_ttc,
        statut: 'metres_en_cours',
      })
      .eq('id', devisId)
    if (errUp) throw errUp

    return NextResponse.json({
      ok: true,
      sections: sectionsFinales,
      total_ht,
      total_ttc,
      transcription,
    })
  } catch (e) {
    console.error('[api/devis/metres-vocaux]', e)
    return NextResponse.json(
      { error: (e as Error).message ?? 'Erreur métrés vocaux' },
      { status: 500 },
    )
  }
}
