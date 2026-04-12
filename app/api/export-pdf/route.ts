import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { jsPDF } from 'jspdf'
import type { RapportContenu } from '@/lib/types'

const PRIMARY_COLOR: [number, number, number] = [16, 185, 129]
const HEADER_COLOR: [number, number, number] = [26, 26, 26]
const MARGIN = 18
const PAGE_WIDTH = 210
const PAGE_HEIGHT = 297
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const PHOTO_WIDTH = CONTENT_WIDTH * 0.85

function addFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(160, 160, 160)
    doc.text('Rapport généré par IONNYX — IA', PAGE_WIDTH / 2, PAGE_HEIGHT - 10, { align: 'center' })
    doc.text(`${i} / ${pageCount}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 10, { align: 'right' })
  }
}

function checkPageBreak(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > PAGE_HEIGHT - 25) {
    doc.addPage()
    return 20
  }
  return y
}

interface ImageData {
  base64: string
  width: number
  height: number
}

async function fetchImageAsBase64(url: string): Promise<ImageData | null> {
  try {
    const res = await fetch(url)
    const buffer = await res.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const dataUrl = `data:${contentType};base64,${base64}`

    // Parse JPEG dimensions from buffer
    const bytes = new Uint8Array(buffer)
    let w = 800, h = 600 // fallback
    // Simple JPEG SOF parser
    for (let i = 0; i < bytes.length - 8; i++) {
      if (bytes[i] === 0xFF && (bytes[i + 1] === 0xC0 || bytes[i + 1] === 0xC2)) {
        h = (bytes[i + 5] << 8) | bytes[i + 6]
        w = (bytes[i + 7] << 8) | bytes[i + 8]
        break
      }
    }
    return { base64: dataUrl, width: w, height: h }
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { chantierId } = await request.json()

  const { data: rapport } = await supabase
    .from('rapports')
    .select('contenu_json')
    .eq('chantier_id', chantierId)
    .single()

  if (!rapport) return NextResponse.json({ error: 'No report found' }, { status: 404 })

  const contenu = rapport.contenu_json as RapportContenu
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  // ---- HEADER (32mm black bar) ----
  doc.setFillColor(...HEADER_COLOR)
  doc.rect(0, 0, PAGE_WIDTH, 32, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('RAPPORT DE VISITE', MARGIN, 16)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(
    `${contenu.client.nom} — ${contenu.client.date_visite || 'Date non renseignée'}`,
    MARGIN,
    24
  )

  let y = 42

  // ---- INFORMATIONS CLIENT ----
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...PRIMARY_COLOR)
  doc.text('INFORMATIONS CLIENT', MARGIN, y)
  y += 8

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(60, 60, 60)
  const clientLines = [
    `Nom : ${contenu.client.nom}`,
    `Adresse : ${contenu.client.adresse || 'Non renseignée'}`,
    `Téléphone : ${contenu.client.telephone || 'Non renseigné'}`,
    `Email : ${contenu.client.email || 'Non renseigné'}`,
    `Date de visite : ${contenu.client.date_visite || 'Non renseignée'}`,
  ]
  for (const line of clientLines) {
    doc.text(line, MARGIN, y)
    y += 5
  }

  y += 4
  doc.setDrawColor(220, 220, 220)
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y)
  y += 8

  // ---- OBSERVATIONS ----
  for (let i = 0; i < contenu.observations.length; i++) {
    const obs = contenu.observations[i]

    y = checkPageBreak(doc, y, 30)

    // Observation title
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...PRIMARY_COLOR)
    doc.text(`OBSERVATION ${i + 1} — ${obs.titre}`, MARGIN, y)
    y += 7

    // Description
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60, 60, 60)
    const descClean = obs.description.replace(/\*\*/g, '')
    const descLines = doc.splitTextToSize(descClean, CONTENT_WIDTH)
    for (const line of descLines) {
      y = checkPageBreak(doc, y, 5)
      doc.text(line, MARGIN, y)
      y += 4.5
    }
    y += 3

    // Photos
    for (const photo of obs.photos) {
      const imgData = await fetchImageAsBase64(photo.url)
      if (imgData) {
        // Calculate height maintaining aspect ratio
        const ratio = imgData.height / imgData.width
        const imgW = PHOTO_WIDTH
        const imgH = Math.min(imgW * ratio, 100) // cap at 100mm
        y = checkPageBreak(doc, y, imgH + 10)
        const imgX = MARGIN + (CONTENT_WIDTH - imgW) / 2
        try {
          doc.addImage(imgData.base64, 'JPEG', imgX, y, imgW, imgH)
          y += imgH + 2
        } catch {
          y += 2
        }
        // Caption
        doc.setFontSize(8)
        doc.setFont('helvetica', 'italic')
        doc.setTextColor(120, 120, 120)
        const captionLines = doc.splitTextToSize(photo.legende, PHOTO_WIDTH)
        for (const cLine of captionLines) {
          doc.text(cLine, PAGE_WIDTH / 2, y, { align: 'center' })
          y += 3.5
        }
        y += 3
      }
    }

    // Points de vigilance
    if (obs.points_vigilance.length > 0) {
      y = checkPageBreak(doc, y, 15 + obs.points_vigilance.length * 5)

      const boxX = MARGIN
      const boxW = CONTENT_WIDTH
      const boxH = 8 + obs.points_vigilance.length * 5

      doc.setFillColor(236, 253, 245)
      doc.setDrawColor(...PRIMARY_COLOR)
      doc.roundedRect(boxX, y, boxW, boxH, 2, 2, 'FD')

      y += 5
      doc.setFontSize(8)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...PRIMARY_COLOR)
      doc.text('Points de vigilance', boxX + 4, y)
      y += 4

      doc.setFont('helvetica', 'normal')
      doc.setTextColor(60, 60, 60)
      for (const point of obs.points_vigilance) {
        const pLines = doc.splitTextToSize(`• ${point}`, boxW - 8)
        for (const pLine of pLines) {
          doc.text(pLine, boxX + 4, y)
          y += 4
        }
      }
      y += 4
    }

    // Separator
    y += 4
    if (i < contenu.observations.length - 1) {
      doc.setDrawColor(220, 220, 220)
      doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y)
      y += 8
    }
  }

  // Extra sections
  if (contenu.acces_chantier) {
    y = checkPageBreak(doc, y, 20)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...PRIMARY_COLOR)
    doc.text('ACCÈS CHANTIER', MARGIN, y)
    y += 6
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60, 60, 60)
    const aLines = doc.splitTextToSize(contenu.acces_chantier, CONTENT_WIDTH)
    for (const l of aLines) { doc.text(l, MARGIN, y); y += 4.5 }
    y += 4
  }

  if (contenu.duree_estimee) {
    y = checkPageBreak(doc, y, 15)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...PRIMARY_COLOR)
    doc.text('DURÉE ESTIMÉE', MARGIN, y)
    y += 6
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60, 60, 60)
    doc.text(contenu.duree_estimee, MARGIN, y)
    y += 8
  }

  if (contenu.notes) {
    y = checkPageBreak(doc, y, 20)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...PRIMARY_COLOR)
    doc.text('NOTES', MARGIN, y)
    y += 6
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60, 60, 60)
    const nLines = doc.splitTextToSize(contenu.notes, CONTENT_WIDTH)
    for (const l of nLines) { doc.text(l, MARGIN, y); y += 4.5 }
  }

  addFooter(doc)

  const pdfBuffer = Buffer.from(doc.output('arraybuffer'))
  const filename = `rapport-visite-${contenu.client.nom.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`

  return new NextResponse(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    },
  })
}
