// Inspection LECTURE SEULE d'un devis Costructor réel.
// Objectif : prendre un vrai devis du compte, faire GET /quotes/{id},
// et afficher la réponse COMPLÈTE (non tronquée) + l'inventaire des champs,
// pour confirmer visuellement l'absence des lignes (articles/quantités/desc).
//
// Aucune écriture : uniquement des requêtes GET.
// Lancement : node --env-file=.env.local scripts/inspect-quote-full.mjs [quoteId]

const BASE = process.env.COSTRUCTOR_API_BASE_URL || 'https://api.costructor.co/external/v1'
const KEY = process.env.COSTRUCTOR_API_KEY

if (!KEY) {
  console.error('COSTRUCTOR_API_KEY manquante dans .env.local')
  process.exit(1)
}

const headers = { Authorization: `Bearer ${KEY}`, Accept: 'application/json' }

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: res.status, statusText: res.statusText, body }
}

// 1) Choisir un vrai devis : soit celui passé en argument, soit on liste le compte.
let quoteId = process.argv[2]

if (!quoteId) {
  console.log('Aucun ID fourni → liste des devis réels du compte (GET /quotes)\n')
  const list = await get('/quotes')
  if (list.status !== 200) {
    console.error(`GET /quotes a échoué : ${list.status} ${list.statusText}`)
    console.error(typeof list.body === 'string' ? list.body : JSON.stringify(list.body))
    process.exit(1)
  }
  const devis = Array.isArray(list.body) ? list.body : list.body.data ?? []
  // On écarte les modèles (model:true) pour prendre un vrai devis.
  const reels = devis.filter((d) => !d.model)
  console.log(`Devis trouvés : ${devis.length} (dont ${reels.length} non-modèles)`)
  for (const d of (reels.length ? reels : devis).slice(0, 10)) {
    console.log(
      `  - ${d.id}` +
        `${d.number ? `  n°${d.number}` : ''}` +
        `${d.title ? `  "${String(d.title).slice(0, 50)}"` : ''}` +
        `${d.model ? '  [MODÈLE]' : ''}`,
    )
  }
  quoteId = (reels[0] ?? devis[0])?.id
  if (!quoteId) {
    console.error('\nAucun devis dans le compte.')
    process.exit(1)
  }
}

// 2) GET /quotes/{id} sur ce vrai devis.
console.log('\n=============================================================')
console.log(`GET /quotes/${quoteId}`)
console.log('=============================================================')

const res = await get(`/quotes/${quoteId}`)
console.log(`HTTP ${res.status} ${res.statusText}\n`)

if (res.status !== 200) {
  console.log(typeof res.body === 'string' ? res.body : JSON.stringify(res.body, null, 2))
  process.exit(1)
}

// La réponse Costructor enveloppe dans { data, metadata }. On montre les deux.
const enveloppe = res.body
const data = enveloppe && typeof enveloppe === 'object' && enveloppe.data !== undefined
  ? enveloppe.data
  : enveloppe

console.log('--- RÉPONSE COMPLÈTE (non tronquée) ---\n')
console.log(JSON.stringify(enveloppe, null, 2))

// 3) Inventaire des champs racine du devis + recherche ciblée des lignes.
if (data && typeof data === 'object') {
  console.log('\n--- INVENTAIRE DES CHAMPS RACINE DU DEVIS ---\n')
  for (const [k, v] of Object.entries(data)) {
    let apercu
    if (v === null) apercu = 'null'
    else if (Array.isArray(v)) apercu = `Array(${v.length})`
    else if (typeof v === 'object') apercu = `Object {${Object.keys(v).join(', ')}}`
    else apercu = JSON.stringify(v)
    console.log(`  ${k.padEnd(22)} : ${String(apercu).slice(0, 80)}`)
  }

  console.log('\n--- RECHERCHE CIBLÉE DES LIGNES (articles/quantités/descriptions) ---\n')
  const candidats = ['lines', 'items', 'products', 'rows', 'entries', 'details', 'lignes']
  let trouve = false
  for (const champ of candidats) {
    if (champ in data) {
      trouve = true
      console.log(`  ⚠ Champ "${champ}" PRÉSENT : ${JSON.stringify(data[champ]).slice(0, 200)}`)
    }
  }
  // Filet de sécurité : tout champ dont le nom évoque une ligne.
  for (const k of Object.keys(data)) {
    if (/line|item|product|article|ligne|qty|quant/i.test(k) && !candidats.includes(k)) {
      trouve = true
      console.log(`  ⚠ Champ suspect "${k}" : ${JSON.stringify(data[k]).slice(0, 200)}`)
    }
  }
  if (!trouve) {
    console.log('  ✓ AUCUN champ de lignes présent (ni lines, items, products, rows, entries, details…).')
    console.log('  ✓ Les articles, quantités et descriptions ne figurent NULLE PART dans la réponse.')
  }
}
