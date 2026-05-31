// Test exhaustif de lecture d'un devis Costructor existant.
// Lancement : node --env-file=.env.local scripts/test-quote-read.mjs

const BASE = 'https://api.costructor.co/external/v1'
const KEY = process.env.COSTRUCTOR_API_KEY
const QUOTE_ID = process.argv[2] || 'quote_01ks38yatyqaakzb1zjmwrgyk1'

if (!KEY) {
  console.error('COSTRUCTOR_API_KEY manquante')
  process.exit(1)
}

const headers = { Authorization: `Bearer ${KEY}`, Accept: 'application/json' }

async function probe(label, path) {
  try {
    const res = await fetch(`${BASE}${path}`, { headers })
    const text = await res.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
    const summary =
      typeof body === 'string'
        ? body.slice(0, 200)
        : JSON.stringify(body).slice(0, 400)
    console.log(`\n[${label}]  GET ${path}`)
    console.log(`  → ${res.status} ${res.statusText}`)
    console.log(`  body: ${summary}`)
    return { status: res.status, body }
  } catch (e) {
    console.log(`\n[${label}]  GET ${path}`)
    console.log(`  → ERR ${e.message}`)
    return { status: 0, body: null }
  }
}

async function probeUrl(label, url) {
  try {
    const res = await fetch(url, { headers })
    const ct = res.headers.get('content-type') || ''
    const cl = res.headers.get('content-length')
    const buf = Buffer.from(await res.arrayBuffer())
    const head = buf.subarray(0, 8).toString('binary')
    console.log(`\n[${label}]  GET ${url}`)
    console.log(`  → ${res.status} ${res.statusText}`)
    console.log(`  content-type: ${ct}`)
    console.log(`  content-length: ${cl || buf.length}`)
    console.log(`  premiers octets: ${JSON.stringify(head)}`)
    console.log(`  signature PDF (%PDF) : ${head.startsWith('%PDF') ? 'OUI' : 'NON'}`)
    return { status: res.status, ct, size: buf.length, head }
  } catch (e) {
    console.log(`\n[${label}]  GET ${url}`)
    console.log(`  → ERR ${e.message}`)
    return null
  }
}

console.log('=============================================================')
console.log(`Devis témoin : ${QUOTE_ID}`)
console.log('=============================================================')

// 0) Récupère le devis brut pour repérer les clés (lines? items? pdf?)
const base = await probe('0. base', `/quotes/${QUOTE_ID}`)
if (base.status === 200 && base.body && typeof base.body === 'object') {
  const data = base.body.data ?? base.body
  console.log(`\n  Clés racine du devis : ${Object.keys(data).join(', ')}`)
  if (data.pdf) {
    console.log(`  → champ "pdf" présent : ${JSON.stringify(data.pdf).slice(0, 300)}`)
  } else {
    console.log(`  → PAS de champ "pdf" à la racine`)
  }
  // Cherche tout champ qui ressemble à des lignes
  for (const k of Object.keys(data)) {
    if (/line|item|product/i.test(k)) {
      console.log(`  → champ ressemblant à des lignes : "${k}" = ${JSON.stringify(data[k]).slice(0, 200)}`)
    }
  }
}

// 1) Variantes d'expansion
await probe('1a. ?include=lines', `/quotes/${QUOTE_ID}?include=lines`)
await probe('1b. ?with=lines', `/quotes/${QUOTE_ID}?with=lines`)
await probe('1c. ?fields=lines', `/quotes/${QUOTE_ID}?fields=lines`)
await probe('1d. ?expand=lines (rappel)', `/quotes/${QUOTE_ID}?expand=lines`)
await probe('1e. ?embed=lines', `/quotes/${QUOTE_ID}?embed=lines`)

// 2) Autres noms de sous-ressource
await probe('2a. /items', `/quotes/${QUOTE_ID}/items`)
await probe('2b. /products', `/quotes/${QUOTE_ID}/products`)
await probe('2c. /lines (rappel)', `/quotes/${QUOTE_ID}/lines`)
await probe('2d. /quote-lines', `/quotes/${QUOTE_ID}/quote-lines`)
await probe('2e. /entries', `/quotes/${QUOTE_ID}/entries`)

// 3) Ressource séparée filtrée
await probe('3a. /lines?quote=', `/lines?quote=${QUOTE_ID}`)
await probe('3b. /quote-lines?quote=', `/quote-lines?quote=${QUOTE_ID}`)
await probe('3c. /quote_lines?quote=', `/quote_lines?quote=${QUOTE_ID}`)
await probe('3d. /items?quote=', `/items?quote=${QUOTE_ID}`)

// 4) PDF — s'il y a un champ pdf.url dans le devis, on le suit
const data = base.body?.data ?? base.body
const pdfUrl = data?.pdf?.url || data?.pdfUrl || data?.pdf_url
if (pdfUrl) {
  console.log(`\n=============================================================`)
  console.log(`4. PDF — URL trouvée : ${pdfUrl}`)
  console.log(`=============================================================`)
  // Avec auth
  await probeUrl('4a. PDF avec Bearer', pdfUrl)
  // Sans auth (parfois URL signée)
  try {
    const res = await fetch(pdfUrl)
    const ct = res.headers.get('content-type') || ''
    const buf = Buffer.from(await res.arrayBuffer())
    const head = buf.subarray(0, 8).toString('binary')
    console.log(`\n[4b. PDF sans auth]  GET ${pdfUrl}`)
    console.log(`  → ${res.status} ${res.statusText}`)
    console.log(`  content-type: ${ct}`)
    console.log(`  taille: ${buf.length}`)
    console.log(`  premiers octets: ${JSON.stringify(head)}`)
    console.log(`  signature PDF : ${head.startsWith('%PDF') ? 'OUI' : 'NON'}`)
  } catch (e) {
    console.log(`  → ERR ${e.message}`)
  }
} else {
  console.log(`\n4. PAS de champ pdf.url trouvé à la racine du devis.`)
  // Tentatives "à l'aveugle" sur des paths plausibles
  await probe('4z1. /pdf', `/quotes/${QUOTE_ID}/pdf`)
  await probe('4z2. /download', `/quotes/${QUOTE_ID}/download`)
  await probe('4z3. /export', `/quotes/${QUOTE_ID}/export`)
}
