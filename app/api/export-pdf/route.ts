import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { jsPDF } from 'jspdf'
import type { RapportContenu } from '@/lib/types'

const PRIMARY: [number, number, number] = [16, 185, 129]
const DARK: [number, number, number] = [26, 26, 26]
const M = 18
const PW = 210
const PH = 297
const CW = PW - M * 2
const PHOTO_W = CW * 0.80

function addFooter(doc: jsPDF) {
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(160, 160, 160)
    doc.text('Rapport généré par IONNYX — IA', PW / 2, PH - 10, { align: 'center' })
    doc.text(`${i} / ${n}`, PW - M, PH - 10, { align: 'right' })
  }
}

function pb(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > PH - 35) { doc.addPage(); return 22 }
  return y
}

async function fetchImg(url: string): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const b64 = Buffer.from(buf).toString('base64')
    const ct = res.headers.get('content-type') || 'image/jpeg'
    const bytes = new Uint8Array(buf)
    let w = 0, h = 0
    for (let i = 0; i < bytes.length - 8; i++) {
      if (bytes[i] === 0xFF && (bytes[i + 1] === 0xC0 || bytes[i + 1] === 0xC2)) {
        h = (bytes[i + 5] << 8) | bytes[i + 6]
        w = (bytes[i + 7] << 8) | bytes[i + 8]
        break
      }
    }
    if (!w || !h) { w = 4; h = 3 }
    return { data: `data:${ct};base64,${b64}`, w, h }
  } catch { return null }
}

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

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: rapport } = await supabase
    .from('rapports')
    .select('contenu_json')
    .eq('chantier_id', chantierId)
    .single()

  if (!rapport) return NextResponse.json({ error: 'No report found' }, { status: 404 })

  const c = rapport.contenu_json as RapportContenu
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  // Header bar
  doc.setFillColor(...DARK)
  doc.rect(0, 0, PW, 32, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('RAPPORT DE VISITE', M, 16)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`${c.client.nom} — ${c.client.date_visite || 'Date non renseignée'}`, M, 24)

  let y = 42

  // Client info
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...PRIMARY)
  doc.text('INFORMATIONS CLIENT', M, y)
  y += 8
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(60, 60, 60)
  for (const line of [
    `Nom : ${c.client.nom}`,
    `Adresse : ${c.client.adresse || 'Non renseignée'}`,
    `Téléphone : ${c.client.telephone || 'Non renseigné'}`,
    `Email : ${c.client.email || 'Non renseigné'}`,
    `Date de visite : ${c.client.date_visite || 'Non renseignée'}`,
  ]) { doc.text(line, M, y); y += 5 }
  y += 4
  doc.setDrawColor(220, 220, 220)
  doc.line(M, y, PW - M, y)
  y += 8

  // Observations
  for (let i = 0; i < c.observations.length; i++) {
    const obs = c.observations[i]
    y = pb(doc, y, 25)

    // Title
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...PRIMARY)
    const tLines = doc.splitTextToSize(`OBSERVATION ${i + 1} — ${obs.titre}`, CW)
    for (const tl of tLines) { y = pb(doc, y, 6); doc.text(tl, M, y); y += 5.5 }
    y += 2

    // Description
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60, 60, 60)
    const dLines = doc.splitTextToSize(obs.description.replace(/\*\*/g, ''), CW)
    for (const dl of dLines) { y = pb(doc, y, 5); doc.text(dl, M, y); y += 4.5 }
    y += 4

    // Photos
    for (const photo of obs.photos) {
      const img = await fetchImg(photo.url)
      if (!img) continue
      const ratio = img.h / img.w
      let imgW = PHOTO_W
      let imgH = imgW * ratio
      if (imgH > 110) { imgH = 110; imgW = imgH / ratio }
      if (imgW > PHOTO_W) { imgW = PHOTO_W; imgH = imgW * ratio }
      y = pb(doc, y, imgH + 15)
      try {
        doc.addImage(img.data, 'JPEG', M + (CW - imgW) / 2, y, imgW, imgH)
        y += imgH + 4
      } catch { continue }
      doc.setFontSize(8)
      doc.setFont('helvetica', 'italic')
      doc.setTextColor(120, 120, 120)
      const capLines = doc.splitTextToSize(photo.legende, PHOTO_W)
      for (const cl of capLines) { y = pb(doc, y, 4); doc.text(cl, PW / 2, y, { align: 'center' }); y += 3.5 }
      y += 5
    }

    // Points de vigilance
    if (obs.points_vigilance && obs.points_vigilance.length > 0) {
      const boxH = 10 + obs.points_vigilance.length * 5
      y = pb(doc, y, boxH + 5)
      doc.setFillColor(236, 253, 245)
      doc.setDrawColor(...PRIMARY)
      doc.roundedRect(M, y, CW, boxH, 2, 2, 'FD')
      y += 6
      doc.setFontSize(8)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...PRIMARY)
      doc.text('Points de vigilance', M + 4, y)
      y += 4
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(60, 60, 60)
      for (const pt of obs.points_vigilance) {
        const ptL = doc.splitTextToSize(`• ${pt}`, CW - 8)
        for (const pl of ptL) { doc.text(pl, M + 4, y); y += 4 }
      }
      y += 5
    }

    y += 3
    if (i < c.observations.length - 1) {
      y = pb(doc, y, 5)
      doc.setDrawColor(220, 220, 220)
      doc.line(M, y, PW - M, y)
      y += 8
    }
  }

  // Extra sections
  if (c.acces_chantier) {
    y = pb(doc, y, 20)
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...PRIMARY)
    doc.text('ACCÈS CHANTIER', M, y); y += 6
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 60)
    for (const l of doc.splitTextToSize(c.acces_chantier, CW)) { y = pb(doc, y, 5); doc.text(l, M, y); y += 4.5 }
    y += 4
  }
  if (c.duree_estimee) {
    y = pb(doc, y, 15)
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...PRIMARY)
    doc.text('DURÉE ESTIMÉE', M, y); y += 6
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 60)
    doc.text(c.duree_estimee, M, y); y += 8
  }
  if (c.notes) {
    y = pb(doc, y, 20)
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...PRIMARY)
    doc.text('NOTES', M, y); y += 6
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 60)
    for (const l of doc.splitTextToSize(c.notes, CW)) { y = pb(doc, y, 5); doc.text(l, M, y); y += 4.5 }
  }

  addFooter(doc)

  const pdfBuffer = Buffer.from(doc.output('arraybuffer'))
  const nom = c.client.nom.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
  const filename = `rapport-visite-${nom}-${new Date().toISOString().slice(0, 10)}.pdf`

  return new NextResponse(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    },
  })
}

// GET — browser navigates here directly (Safari opens PDF natively)
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

// POST — kept for backwards compat
export async function POST(request: Request) {
  try {
    const { chantierId } = await request.json()
    if (!chantierId) return NextResponse.json({ error: 'Missing chantierId' }, { status: 400 })
    return await buildPdf(chantierId)
  } catch {
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 })
  }
}
