import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { construireRapportPdf } from '@/lib/rapport-pdf'
import { formaterHeureVisite, nomFichierRapport } from '@/lib/utils'
import type { RapportContenu } from '@/lib/types'

export const runtime = 'nodejs'

// Sert le PDF du compte rendu en INLINE (ouverture en nouvel onglet, decision du
// lot 6.3). Le nom de fichier est porte par le DERNIER SEGMENT de l'URL
// ([fichier]) : c'est ce segment que le navigateur (notamment Safari mobile)
// utilise pour nommer le PDF a la visualisation et a l'enregistrement, en plus du
// Content-Disposition. La logique jsPDF vit dans lib/rapport-pdf.ts. Lecture seule.
export async function GET(
  _request: Request,
  { params }: { params: { chantierId: string; fichier: string } },
) {
  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          },
        },
      },
    )

    const { data: rapport } = await supabase
      .from('rapports')
      .select('contenu_json')
      .eq('chantier_id', params.chantierId)
      .single()
    if (!rapport) return NextResponse.json({ error: 'No report found' }, { status: 404 })

    // Date de visite : sert a l'heure du PDF (lot 3.6) et au nom de fichier
    // (lot 3.4, date de la visite plutot que la date du jour).
    const { data: chantier } = await supabase
      .from('chantiers')
      .select('date_visite')
      .eq('id', params.chantierId)
      .single()
    const dateVisiteIso =
      (chantier as { date_visite: string | null } | null)?.date_visite ?? null
    const heure = formaterHeureVisite(dateVisiteIso)

    const c = rapport.contenu_json as RapportContenu
    const pdfBuffer = await construireRapportPdf(c, heure)
    const filename = nomFichierRapport(c.client.nom, dateVisiteIso)

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        // PII client : empêcher toute mise en cache par un proxy/CDN intermédiaire.
        'Cache-Control': 'private, no-store',
      },
    })
  } catch {
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 })
  }
}
