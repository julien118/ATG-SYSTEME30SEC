import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { construireRapportPdf } from '@/lib/rapport-pdf'
import { formaterHeureVisite, nomFichierRapport } from '@/lib/utils'
import type { RapportContenu } from '@/lib/types'

// Mode démo ATG : pas de check d'auth.
// Sert le PDF du compte rendu construit a la volee depuis le contenu courant.
// La logique jsPDF vit dans lib/rapport-pdf.ts (partagee avec la persistance).
async function buildPdf(chantierId: string): Promise<NextResponse> {
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
    }
  )

  const { data: rapport } = await supabase
    .from('rapports')
    .select('contenu_json')
    .eq('chantier_id', chantierId)
    .single()

  if (!rapport) return NextResponse.json({ error: 'No report found' }, { status: 404 })

  // Date de visite du chantier : sert a l'heure du PDF (lot 3.6) et au nom de
  // fichier (lot 3.4, date de la visite plutot que la date du jour).
  const { data: chantier } = await supabase
    .from('chantiers')
    .select('date_visite')
    .eq('id', chantierId)
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
    },
  })
}

// GET — le navigateur ouvre directement le PDF (Safari le lit nativement).
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const chantierId = searchParams.get('chantierId')
    if (!chantierId) return NextResponse.json({ error: 'Missing chantierId' }, { status: 400 })
    return await buildPdf(chantierId)
  } catch {
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 })
  }
}

// POST — conserve pour compatibilite ascendante.
export async function POST(request: Request) {
  try {
    const { chantierId } = await request.json()
    if (!chantierId) return NextResponse.json({ error: 'Missing chantierId' }, { status: 400 })
    return await buildPdf(chantierId)
  } catch {
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 })
  }
}
