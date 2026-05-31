// Approfondissement PDF — l'URL retournée pointe vers /api/files/... (pas /external/v1/...)
// et renvoie 401 avec ou sans Bearer. On teste plusieurs variantes.
const BASE = 'https://api.costructor.co/external/v1'
const KEY = process.env.COSTRUCTOR_API_KEY
const QUOTE_ID = process.argv[2] || 'quote_01ks38yatyqaakzb1zjmwrgyk1'

const authHeaders = { Authorization: `Bearer ${KEY}`, Accept: '*/*' }

async function inspect(label, url, headers = {}) {
  try {
    const res = await fetch(url, { headers, redirect: 'manual' })
    const ct = res.headers.get('content-type') || ''
    const loc = res.headers.get('location')
    const buf = Buffer.from(await res.arrayBuffer())
    const head = buf.subarray(0, 16).toString('binary')
    console.log(`\n[${label}]`)
    console.log(`  URL: ${url}`)
    console.log(`  → ${res.status} ${res.statusText}`)
    console.log(`  content-type: ${ct}`)
    if (loc) console.log(`  location: ${loc}`)
    console.log(`  taille: ${buf.length}`)
    console.log(
      `  premiers octets: ${head
        .split('')
        .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126 ? '.' : c))
        .join('')}`,
    )
    console.log(`  %PDF ? ${head.startsWith('%PDF') ? 'OUI' : 'NON'}`)
    if (ct.includes('json') && buf.length < 500) {
      console.log(`  body: ${buf.toString('utf8')}`)
    }
    return { status: res.status, ct, loc, buf, head }
  } catch (e) {
    console.log(`\n[${label}] ${url}\n  → ERR ${e.message}`)
    return null
  }
}

// 1. Récupère l'URL fraîche
const res = await fetch(`${BASE}/quotes/${QUOTE_ID}`, { headers: authHeaders })
const json = await res.json()
const data = json.data ?? json
const pdf = data.pdf
console.log('Champ pdf complet :')
console.log(JSON.stringify(pdf, null, 2))

const pdfUrl = pdf?.url
const fileId = pdf?.id
console.log(`\nURL fraîche : ${pdfUrl}`)
console.log(`File ID : ${fileId}`)

// 2. Tests d'accès
if (pdfUrl) {
  await inspect('A. URL telle quelle, sans header', pdfUrl)
  await inspect('B. URL + Bearer', pdfUrl, authHeaders)
  await inspect('C. URL + Bearer + Accept pdf', pdfUrl, {
    Authorization: `Bearer ${KEY}`,
    Accept: 'application/pdf',
  })
  // Suit les redirections normalement
  try {
    const r = await fetch(pdfUrl, { headers: authHeaders, redirect: 'follow' })
    const buf = Buffer.from(await r.arrayBuffer())
    console.log(`\n[D. redirect follow + Bearer] → ${r.status} ${r.statusText}, taille ${buf.length}, %PDF ? ${buf.subarray(0,4).toString() === '%PDF' ? 'OUI' : 'NON'}`)
  } catch (e) {
    console.log(`\n[D] ERR ${e.message}`)
  }
}

// 3. Path /external/v1/files/{id}/content (au cas où)
if (fileId) {
  await inspect(
    'E. /external/v1/files/{id}/content + Bearer',
    `${BASE}/files/${fileId}/content`,
    authHeaders,
  )
  await inspect(
    'F. /external/v1/files/{id} + Bearer (métadonnées)',
    `${BASE}/files/${fileId}`,
    authHeaders,
  )
  await inspect(
    'G. /external/v1/files/{id}/download',
    `${BASE}/files/${fileId}/download`,
    authHeaders,
  )
}

// 4. Le devis exposé en PDF directement ?
await inspect('H. /quotes/{id} avec Accept: application/pdf', `${BASE}/quotes/${QUOTE_ID}`, {
  Authorization: `Bearer ${KEY}`,
  Accept: 'application/pdf',
})
await inspect('I. /quotes/{id}.pdf', `${BASE}/quotes/${QUOTE_ID}.pdf`, authHeaders)
