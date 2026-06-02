// =============================================================
// Generation + persistance du PDF de compte rendu (Phase G, etape 1)
// =============================================================
// `construireRapportPdf` : logique jsPDF pure (A4, photos, points de vigilance),
// extraite de app/api/export-pdf pour etre reutilisable cote route ET cote script.
// `persistRapportPdf` : enregistre le PDF dans Supabase Storage a un chemin
// deterministe (bucket public 'rapports', objet '{chantier_id}.pdf') puis stocke
// l'URL stable dans rapports.pdf_url. Ecrasement (upsert) a chaque (re)generation,
// donc pas d'accumulation et URL inchangee.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { jsPDF } from 'jspdf'
import { createAdminClient } from './supabase/admin'
import type { RapportContenu } from './types'

const PRIMARY: [number, number, number] = [16, 185, 129]
const DARK: [number, number, number] = [26, 26, 26]
const M = 18
const PW = 210
const PH = 297
const CW = PW - M * 2
const PHOTO_W = CW * 0.8

const BUCKET_RAPPORTS = 'rapports'

// Logo ATG blanc pour le bandeau sombre (lot 3.1). Lu une seule fois depuis
// public/ et mis en cache en data URL base64 pour jsPDF. Source 128x64 (ratio 2:1).
// Les routes PDF tournent en runtime Node, donc l'acces disque est disponible.
const LOGO_ATG_RATIO = 128 / 64
let logoAtgBlancCache: string | null = null
function logoAtgBlanc(): string | null {
  if (logoAtgBlancCache) return logoAtgBlancCache
  try {
    const buf = readFileSync(join(process.cwd(), 'public', 'logo-atg-blanc.png'))
    logoAtgBlancCache = `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    logoAtgBlancCache = null
  }
  return logoAtgBlancCache
}

function addFooter(doc: jsPDF) {
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(160, 160, 160)
    doc.text('Rapport généré par ATG, propulsé par IONNYX', PW / 2, PH - 10, { align: 'center' })
    doc.text(`${i} / ${n}`, PW - M, PH - 10, { align: 'right' })
  }
}

// Saut de page si l'espace restant est insuffisant.
function pb(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > PH - 35) { doc.addPage(); return 22 }
  return y
}

// Telecharge une image et lit ses dimensions depuis l'entete JPEG.
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
      if (bytes[i] === 0xff && (bytes[i + 1] === 0xc0 || bytes[i + 1] === 0xc2)) {
        h = (bytes[i + 5] << 8) | bytes[i + 6]
        w = (bytes[i + 7] << 8) | bytes[i + 8]
        break
      }
    }
    if (!w || !h) { w = 4; h = 3 }
    return { data: `data:${ct};base64,${b64}`, w, h }
  } catch { return null }
}

// Construit le PDF A4 du compte rendu et renvoie ses octets (ArrayBuffer, valide
// comme corps de NextResponse et comme contenu d'upload Storage).
export async function construireRapportPdf(c: RapportContenu): Promise<ArrayBuffer> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  // Bandeau d'en-tete sombre (lot 3.1) : logo ATG blanc a gauche, titre et date a
  // droite.
  const BAND_H = 36
  doc.setFillColor(...DARK)
  doc.rect(0, 0, PW, BAND_H, 'F')

  const logo = logoAtgBlanc()
  if (logo) {
    const logoH = 12
    const logoW = logoH * LOGO_ATG_RATIO
    try {
      doc.addImage(logo, 'PNG', M, (BAND_H - logoH) / 2, logoW, logoH)
    } catch {
      // Logo indisponible : on continue sans bloquer la generation du PDF.
    }
  }

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(17)
  doc.setFont('helvetica', 'bold')
  doc.text('RAPPORT DE VISITE', PW - M, 16, { align: 'right' })
  doc.setFontSize(9.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(205, 205, 205)
  doc.text(c.client.date_visite || 'Date non renseignée', PW - M, 24, { align: 'right' })

  let y = BAND_H + 12

  // Coordonnees (lot 3.2 : libelle neutre, sans le mot "client" remis au client).
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...PRIMARY)
  doc.text('COORDONNÉES', M, y)
  // Filet d'accent sous le titre de section pour la hierarchie visuelle.
  doc.setDrawColor(...PRIMARY)
  doc.setLineWidth(0.6)
  doc.line(M, y + 1.8, M + 22, y + 1.8)
  doc.setLineWidth(0.2)
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

    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...PRIMARY)
    const tLines = doc.splitTextToSize(`OBSERVATION ${i + 1} — ${obs.titre}`, CW)
    for (const tl of tLines) { y = pb(doc, y, 6); doc.text(tl, M, y); y += 5.5 }
    y += 2

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60, 60, 60)
    const dLines = doc.splitTextToSize(obs.description.replace(/\*\*/g, ''), CW)
    for (const dl of dLines) { y = pb(doc, y, 5); doc.text(dl, M, y); y += 4.5 }
    y += 4

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

  // Sections complementaires
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
  return doc.output('arraybuffer') as ArrayBuffer
}

// Genere le PDF du compte rendu d'un chantier, le persiste dans le Storage a un
// chemin deterministe, stocke l'URL stable dans rapports.pdf_url, et la renvoie.
// Utilise le client service_role (cote serveur uniquement, contourne la RLS storage).
export async function persistRapportPdf(
  chantierId: string,
): Promise<{ url: string; path: string; taille: number }> {
  const supabase = createAdminClient()

  const { data: rapport, error } = await supabase
    .from('rapports')
    .select('contenu_json')
    .eq('chantier_id', chantierId)
    .single()
  if (error || !rapport?.contenu_json) {
    throw new Error(`Rapport introuvable pour le chantier ${chantierId}`)
  }

  const buffer = await construireRapportPdf(rapport.contenu_json as RapportContenu)
  const path = `${chantierId}.pdf`

  // upsert: true -> ecrasement au meme chemin a la regeneration (pas d'accumulation).
  const { error: upErr } = await supabase.storage
    .from(BUCKET_RAPPORTS)
    .upload(path, buffer, { contentType: 'application/pdf', upsert: true })
  if (upErr) throw new Error(`Upload du PDF echoue : ${upErr.message}`)

  const { data: urlData } = supabase.storage.from(BUCKET_RAPPORTS).getPublicUrl(path)
  const url = urlData.publicUrl

  const { error: dbErr } = await supabase
    .from('rapports')
    .update({ pdf_url: url })
    .eq('chantier_id', chantierId)
  if (dbErr) throw new Error(`MAJ rapports.pdf_url echouee : ${dbErr.message}`)

  return { url, path, taille: buffer.byteLength }
}

// =============================================================
// Lien du compte rendu dans le devis (Phase G, etape 2)
// =============================================================
// Workaround valide en R2 : l'upload direct d'un fichier dans Costructor renvoie
// 401, donc on ne joint pas une vraie piece jointe. A la place, on insere l'URL
// stable du PDF de compte rendu dans la description du devis, sous une ligne
// clairement intitulee. Si le PDF n'a pas encore ete genere (pas d'URL), on
// n'ajoute rien : pas de ligne cassee ni de lien vide.

// Texte cliquable affiché (pas l'URL brute) : le champ description de Costructor
// est rendu en HTML, on insère donc une vraie ancre <a href> plutôt qu'un texte
// noir non cliquable.
const TEXTE_LIEN_CR = 'Cliquez ici pour visualiser votre compte rendu'

// Lit l'URL stable du PDF de compte rendu d'un chantier dans rapports.pdf_url.
// Renvoie null si le rapport n'existe pas encore ou si aucun PDF n'a ete persiste
// (colonne nulle/vide). On utilise maybeSingle pour ne pas lever quand il n'y a
// pas de ligne rapport pour ce chantier.
export async function recupererUrlRapportPdf(
  chantierId: string,
): Promise<string | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('rapports')
    .select('pdf_url')
    .eq('chantier_id', chantierId)
    .maybeSingle()
  if (error) return null
  const url = ((data?.pdf_url as string | null) ?? '').trim()
  return url || null
}

// Ajoute un lien cliquable "Compte rendu de visite" (ancre HTML) a une
// description de devis. Fonction pure (testable sans base) : si l'URL est
// absente, la description est renvoyee telle quelle, sans lien ni ancre vide.
// Le lien est mis sur son propre paragraphe (<br><br>), nettement separe du
// texte qui precede. Idempotente : si un lien vers la meme URL est deja present,
// on ne le duplique pas (re-push d'un meme devis).
export function ajouterLienCompteRendu(
  description: string,
  url: string | null | undefined,
): string {
  const u = (url ?? '').trim()
  if (!u) return description ?? ''
  const base = (description ?? '').trimEnd()
  if (base.includes(`href="${u}"`)) return base
  // Lot 6.3 : lien bleu + gras, ouverture nouvel onglet. Markup combine
  // « ceinture et bretelles » : couleur via style inline (levier principal) et
  // gras via la balise semantique <strong> (repli si le style est ignore par le
  // moteur PDF de Costructor). target/rel pour le rendu HTML cote interface ; en
  // PDF un lien s'ouvre de toute facon dans le navigateur.
  const lienHtml =
    `<a href="${u}" target="_blank" rel="noopener" ` +
    `style="color:#2563eb;font-weight:700;"><strong>${TEXTE_LIEN_CR}</strong></a>`
  return base ? `${base}<br><br>${lienHtml}` : lienHtml
}

// Compose la description finale d'un devis en y integrant le lien du compte rendu
// du chantier, si un PDF a ete persiste. Sinon, renvoie la description de base
// inchangee. C'est le point d'entree a appeler au moment du push.
export async function composerDescriptionAvecRapport(
  description: string,
  chantierId: string | null | undefined,
): Promise<string> {
  if (!chantierId) return description ?? ''
  const url = await recupererUrlRapportPdf(chantierId)
  return ajouterLienCompteRendu(description, url)
}
