// =============================================================
// Clone l'espace Costructor d'OLIVIER (source, LECTURE) vers celui de
// JULIEN (cible, ECRITURE) pour crash-tester avant la prod.
// =============================================================
// Perimetre (decide avec Julien) : tous les produits + contacts ANONYMISES
// + les 7 modeles + un echantillon de ~15 devis recents (ravalement/ITE).
//
// SOURCE = COSTRUCTOR_API_KEY_OLIVIER (GET only). CIBLE = COSTRUCTOR_API_KEY_JULIEN (POST).
// Idempotent : une map d'IDs (ancien Olivier -> nouveau Julien) est persistee dans
// data/clone-olivier-julien/map.json ; un objet deja cloné est saute.
// Les IDs sont regeneres par Costructor ; les references produit/contact des devis
// sont remappees via la map. Statuts non reproductibles (POST = brouillon).
//
// Lancement par phase :
//   node --env-file=.env.local scripts/clone-olivier-vers-julien.mjs products
//   node --env-file=.env.local scripts/clone-olivier-vers-julien.mjs contacts
//   node --env-file=.env.local scripts/clone-olivier-vers-julien.mjs quotes

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.COSTRUCTOR_API_BASE_URL || 'https://api.costructor.co/external/v1'
const KEY_OLIVIER = process.env.COSTRUCTOR_API_KEY_OLIVIER
const KEY_JULIEN = process.env.COSTRUCTOR_API_KEY_JULIEN || process.env.COSTRUCTOR_API_KEY
if (!KEY_OLIVIER || !KEY_JULIEN) {
  console.error('Cles manquantes : COSTRUCTOR_API_KEY_OLIVIER et COSTRUCTOR_API_KEY_JULIEN(.._KEY).')
  process.exit(1)
}
const hO = { Authorization: `Bearer ${KEY_OLIVIER}`, Accept: 'application/json' }
const hJ = { Authorization: `Bearer ${KEY_JULIEN}`, Accept: 'application/json', 'Content-Type': 'application/json' }

const DIR = join(process.cwd(), 'data', 'clone-olivier-julien')
const MAP_FILE = join(DIR, 'map.json')
mkdirSync(DIR, { recursive: true })
const map = existsSync(MAP_FILE)
  ? JSON.parse(readFileSync(MAP_FILE, 'utf8'))
  : { products: {}, contacts: {}, quotes: {} }
const saveMap = () => writeFileSync(MAP_FILE, JSON.stringify(map, null, 2), 'utf8')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const THROTTLE = 300

// GET source (Olivier).
async function getO(path) {
  const r = await fetch(`${BASE}${path}`, { headers: hO })
  return r.json()
}
// POST cible (Julien) avec retry 429.
async function postJ(path, body) {
  let delai = 800
  for (let i = 1; i <= 6; i++) {
    const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: hJ, body: JSON.stringify(body) })
    if (r.status === 429) { await sleep(delai); delai *= 2; continue }
    const txt = await r.text()
    let j; try { j = txt ? JSON.parse(txt) : null } catch { j = txt }
    return { status: r.status, body: j }
  }
  return { status: 429, body: 'rate limit persistant' }
}

const banner = (phase) => {
  console.log('=============================================================')
  console.log(`CLONE phase "${phase}"`)
  console.log(`  SOURCE (lecture) : OLIVIER  ...${KEY_OLIVIER.slice(-6)}`)
  console.log(`  CIBLE  (ecriture): JULIEN   ...${KEY_JULIEN.slice(-6)}`)
  console.log('=============================================================\n')
}

// ---------------------------------------------------------------
// PHASE PRODUITS
// ---------------------------------------------------------------
async function clonerProduits() {
  banner('produits')
  const j = await getO('/products?_limit=3000')
  const produits = j.data || []
  console.log(`${produits.length} produits source (total ${j.metadata && j.metadata.items})`)
  let crees = 0, sautes = 0, echecs = 0
  for (let i = 0; i < produits.length; i++) {
    const p = produits[i]
    if (map.products[p.id]) { sautes++; continue }
    const body = { name: p.name, type: p.type }
    if (p.unit && p.unit.id) body.unit = p.unit.id
    // sellPrice est obligatoire cote API : si Olivier l'a laisse vide, on met 0.
    body.sellPrice = p.sellPrice != null ? p.sellPrice : 0
    if (p.buyPrice != null) body.buyPrice = p.buyPrice
    const res = await postJ('/products', body)
    if (res.status === 200) {
      map.products[p.id] = (res.body.data || res.body).id
      crees++
    } else {
      echecs++
      if (echecs <= 10) console.log(`  ! echec ${p.type} "${String(p.name).slice(0, 30)}" -> ${res.status} ${JSON.stringify(res.body).slice(0, 80)}`)
    }
    if ((i + 1) % 50 === 0) { saveMap(); console.log(`  ... ${i + 1}/${produits.length} (crees ${crees}, sautes ${sautes}, echecs ${echecs})`) }
    await sleep(THROTTLE)
  }
  saveMap()
  console.log(`\nProduits : crees ${crees}, deja presents ${sautes}, echecs ${echecs}. Map = ${Object.keys(map.products).length}`)
}

// ---------------------------------------------------------------
// PHASE CONTACTS (anonymises)
// ---------------------------------------------------------------
function contactAnonyme(src, n) {
  const id = String(n).padStart(3, '0')
  const estSociete = src.legalStatus === 'company' || src.companyName
  const body = { type: src.type || 'client', legalStatus: src.legalStatus || 'individual' }
  if (estSociete) {
    body.companyName = `Societe Test ${id}`
    body.firstName = ''
    body.lastName = `Test ${id}`
  } else {
    body.firstName = 'Client'
    body.lastName = `Test ${id}`
  }
  // Signaux deterministes et matchables (pour tester la dedup) mais 100% fictifs.
  if ((src.emails && src.emails.length) || src.email) body.emails = [{ email: `client${id}@test.local`, primary: true }]
  if ((src.phones && src.phones.length) || src.phone) body.phones = [{ phone: `06${id.padStart(8, '0')}`, primary: true }]
  if ((src.addresses && src.addresses.length) || src.address)
    body.addresses = [{ address: { street: `${n} rue des Tests`, postal_code: '37000', city: 'Tours', country: 'FR' }, primary: true }]
  return body
}
async function clonerContacts() {
  banner('contacts (anonymises)')
  const j = await getO('/contacts?_limit=1000')
  const contacts = j.data || []
  console.log(`${contacts.length} contacts source (total ${j.metadata && j.metadata.items}) -> recrees ANONYMISES`)
  let crees = 0, sautes = 0, echecs = 0, n = 0
  for (const c of contacts) {
    n++
    if (map.contacts[c.id]) { sautes++; continue }
    const res = await postJ('/contacts', contactAnonyme(c, n))
    if (res.status === 200) { map.contacts[c.id] = (res.body.data || res.body).id; crees++ }
    else { echecs++; if (echecs <= 10) console.log(`  ! echec contact -> ${res.status} ${JSON.stringify(res.body).slice(0, 80)}`) }
    if (n % 50 === 0) { saveMap(); console.log(`  ... ${n}/${contacts.length}`) }
    await sleep(THROTTLE)
  }
  saveMap()
  console.log(`\nContacts : crees ${crees}, deja presents ${sautes}, echecs ${echecs}. Map = ${Object.keys(map.contacts).length}`)
}

// ---------------------------------------------------------------
// PHASE DEVIS (7 modeles + echantillon recent ravalement/ITE)
// ---------------------------------------------------------------
const CONTACT_FALLBACK = 'cnt_01krjzeat6za819h7zbssvjxj0' // contact demo Julien (Dupont)
function transformerLignes(lignes) {
  const out = []
  for (const l of [...(lignes || [])].sort((a, b) => (a.position || 0) - (b.position || 0))) {
    if (l.type === 'group') {
      out.push({ type: 'group', description: l.description || '', lines: transformerLignes(l.lines) })
    } else if (l.type === 'product') {
      const prodId = l.product && map.products[l.product.id]
      if (!prodId) continue // produit non cloné : on saute la ligne
      const ligne = { type: 'product', product: prodId, description: l.description || '', quantity: l.quantity != null ? l.quantity : 1 }
      if (l.sellPrice != null) ligne.sellPrice = l.sellPrice
      if (l.unit && l.unit.id) ligne.unit = l.unit.id
      out.push(ligne)
    } else {
      out.push({ type: 'text', description: l.description || '' })
    }
  }
  return out
}
async function clonerDevis() {
  banner('devis (modeles + echantillon)')
  if (!Object.keys(map.products).length) { console.error('Map produits vide : lancer la phase "products" avant.'); process.exit(1) }
  const j = await getO('/quotes?_sort=createdAt&_order=desc&_limit=1000')
  const tous = j.data || []
  const modeles = tous.filter((q) => q.model)
  const rgxPertinent = /ravalement|facade|façade|ite|isolation thermique|enduit|imperm/i
  const echantillon = tous
    .filter((q) => !q.model && q.status !== 'deleted')
    .filter((q) => rgxPertinent.test(`${q.description || ''} ${q.name || ''}`))
    .slice(0, 15)
  const cibles = [...modeles, ...echantillon]
  console.log(`${modeles.length} modeles + ${echantillon.length} devis echantillon = ${cibles.length} a cloner\n`)

  let crees = 0, sautes = 0, echecs = 0, vides = 0
  for (const q of cibles) {
    if (map.quotes[q.id]) { sautes++; continue }
    const d = await getO(`/quotes/${q.id}?_expand=lines`)
    const full = d.data || d
    const lignes = transformerLignes(full.lines)
    if (!lignes.length) { vides++; console.log(`  (vide, saute) ${q.number || q.id} ${full.model ? '[MODELE]' : ''}`); continue }
    const customer = (full.customer && map.contacts[full.customer.id]) || CONTACT_FALLBACK
    const body = { customer, description: full.description || full.name || 'Clone', lines: lignes }
    if (full.model) body.model = true
    if (full.issuedAt) body.issuedAt = full.issuedAt
    const res = await postJ('/quotes', body)
    if (res.status === 200) {
      const nv = res.body.data || res.body
      map.quotes[q.id] = nv.id
      crees++
      const ecart = full.total != null && nv.total != null ? Math.abs(nv.total - full.total) : 0
      const flag = ecart > Math.max(100, full.total * 0.01) ? `  /!\\ total source ${full.total} vs clone ${nv.total}` : ''
      console.log(`  + ${full.model ? '[MODELE] ' : ''}${(q.number || q.id).padEnd(14)} -> ${nv.id}  total ${nv.total / 100}EUR${flag}`)
    } else {
      echecs++
      console.log(`  ! echec ${q.number || q.id} -> ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`)
    }
    saveMap()
    await sleep(THROTTLE)
  }
  console.log(`\nDevis : crees ${crees}, deja presents ${sautes}, vides ${vides}, echecs ${echecs}.`)
}

// ---------------------------------------------------------------
const phase = process.argv[2]
const run = { products: clonerProduits, contacts: clonerContacts, quotes: clonerDevis }[phase]
if (!run) { console.error('Phase inconnue. Usage: products | contacts | quotes'); process.exit(1) }
run().catch((e) => { console.error(e); saveMap(); process.exit(1) })
