// =============================================================
// Tache 1 — Valider le mecanisme _expand=lines (compte de TEST Julien)
// =============================================================
// Le support Costructor indique qu'on peut recuperer le detail des lignes
// d'un devis via le query param `_expand=lines`. Les anciens scripts ont deja
// teste `?expand=lines` (sans underscore), `?include=`, `?with=`, et les
// sous-ressources /lines, /items... sans succes. Ici on teste UNIQUEMENT la
// nouvelle piste : `_expand=lines` AVEC underscore.
//
// LECTURE SEULE : uniquement des requetes GET, aucune ecriture.
// Lancement : node --env-file=.env.local test-expand-lines.mjs [quoteId]

const BASE =
  process.env.COSTRUCTOR_API_BASE_URL || 'https://api.costructor.co/external/v1'

// Cle du compte de TEST de Julien. On accepte le nom dedie du brief, avec
// repli sur COSTRUCTOR_API_KEY (la cle de Julien deja presente dans .env.local).
const KEY = process.env.COSTRUCTOR_API_KEY_JULIEN || process.env.COSTRUCTOR_API_KEY

if (!KEY) {
  console.error(
    'Cle manquante : definir COSTRUCTOR_API_KEY_JULIEN (ou COSTRUCTOR_API_KEY) dans .env.local',
  )
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

// Costructor enveloppe ses reponses dans { data, metadata }. On deballe.
function unwrap(enveloppe) {
  if (enveloppe && typeof enveloppe === 'object' && 'data' in enveloppe) {
    return enveloppe.data
  }
  return enveloppe
}

function asArray(v) {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object') {
    if (Array.isArray(v.data)) return v.data
    if (Array.isArray(v.items)) return v.items
  }
  return []
}

// Renvoie la premiere valeur non nulle parmi une liste de noms de champ candidats.
function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null) return obj[k]
  }
  return undefined
}

// Strip HTML (les descriptions Costructor sont enrobees de <strong>, <br>...).
function stripHtml(s) {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Montants en centimes -> euros lisibles.
function euros(cents) {
  if (cents == null || Number.isNaN(Number(cents))) return 'n/a'
  return `${(Number(cents) / 100).toFixed(2)} EUR (${cents} c)`
}

// Repere le tableau de lignes dans un devis (nom de champ a confirmer).
const CHAMPS_LIGNES = ['lines', 'items', 'products', 'rows', 'entries', 'lignes', 'details']
function trouverLignes(devis) {
  for (const champ of CHAMPS_LIGNES) {
    if (devis && Array.isArray(devis[champ])) {
      return { champ, lignes: devis[champ] }
    }
  }
  return { champ: null, lignes: null }
}

// =============================================================
console.log('=============================================================')
console.log('Tache 1 — test _expand=lines (compte de TEST Julien)')
console.log(`Base : ${BASE}`)
console.log('=============================================================\n')

// 1) Liste des devis AVEC _expand=lines.
console.log('[1] GET /quotes?_expand=lines')
const liste = await get('/quotes?_expand=lines')
console.log(`    -> HTTP ${liste.status} ${liste.statusText}`)
if (liste.status !== 200) {
  console.error('    Echec de la liste des devis :')
  console.error(
    typeof liste.body === 'string'
      ? liste.body
      : JSON.stringify(liste.body, null, 2),
  )
  process.exit(1)
}

const devisListe = asArray(unwrap(liste.body))
console.log(`    -> ${devisListe.length} devis dans le compte`)
for (const d of devisListe.slice(0, 10)) {
  const { champ, lignes } = trouverLignes(d)
  console.log(
    `       - ${d.id}` +
      `${d.number ? ` n°${d.number}` : ''}` +
      `${d.title ? ` "${stripHtml(d.title).slice(0, 40)}"` : ''}` +
      `${d.model ? ' [MODELE]' : ''}` +
      `${champ ? ` -> ${lignes.length} ligne(s) dans .${champ}` : ' -> AUCUNE ligne'}`,
  )
}

// Choix du devis a inspecter : argument CLI, sinon premier non-modele, sinon premier.
let quoteId = process.argv[2]
if (!quoteId) {
  const reels = devisListe.filter((d) => !d.model)
  quoteId = (reels[0] ?? devisListe[0])?.id
}
if (!quoteId) {
  console.error('\nAucun devis dans le compte : impossible de tester _expand=lines.')
  process.exit(1)
}

// 2) Baseline SANS le param, pour prouver que _expand=lines ajoute bien les lignes.
console.log(`\n[2] Baseline GET /quotes/${quoteId} (sans _expand)`)
const baseline = await get(`/quotes/${quoteId}`)
const devisBaseline = unwrap(baseline.body)
const ligBaseline = trouverLignes(devisBaseline)
console.log(`    -> HTTP ${baseline.status}`)
console.log(
  `    -> champ lignes : ${ligBaseline.champ ? `.${ligBaseline.champ} (${ligBaseline.lignes.length})` : 'ABSENT'}`,
)

// 3) Le test : GET /quotes/{id}?_expand=lines.
console.log(`\n[3] GET /quotes/${quoteId}?_expand=lines`)
const detail = await get(`/quotes/${quoteId}?_expand=lines`)
console.log(`    -> HTTP ${detail.status} ${detail.statusText}`)
if (detail.status !== 200) {
  console.error(
    typeof detail.body === 'string'
      ? detail.body
      : JSON.stringify(detail.body, null, 2),
  )
  process.exit(1)
}
const devis = unwrap(detail.body)

// 4) JSON brut complet du devis (demande par le brief).
console.log('\n--- JSON BRUT DU DEVIS (avec _expand=lines) ---\n')
console.log(JSON.stringify(devis, null, 2))

// 5) Detail des lignes.
const { champ, lignes } = trouverLignes(devis)
console.log('\n--- ANALYSE DES LIGNES ---\n')
if (!champ) {
  console.log('  AUCUN tableau de lignes trouve dans la reponse.')
  console.log(`  Champs racine disponibles : ${Object.keys(devis ?? {}).join(', ')}`)
} else {
  console.log(`  Champ detecte : ".${champ}"  (${lignes.length} ligne(s))\n`)
  lignes.forEach((l, i) => {
    const description = stripHtml(
      pick(l, ['description', 'name', 'label', 'title', 'text']),
    )
    const prix = pick(l, ['sellPrice', 'unitPrice', 'unit_price', 'price', 'sellingPrice', 'amount'])
    const qte = pick(l, ['quantity', 'qty', 'quantite'])
    const tva = pick(l, ['tax', 'taxRate', 'tax_rate', 'vat', 'vatRate', 'tva'])
    const type = pick(l, ['type'])
    console.log(`  Ligne ${i + 1}${type ? ` [${type}]` : ''}`)
    console.log(`    description : ${description || '(vide)'}`)
    console.log(`    prix unit.  : ${euros(prix)}`)
    console.log(`    quantite    : ${qte ?? 'n/a'}`)
    console.log(`    tva         : ${tva ?? 'n/a'}`)
  })
}

// 6) Verdict de validation.
console.log('\n--- VERDICT ---\n')
const baseAvait = ligBaseline.champ != null
const expandDonne = champ != null && lignes.length > 0
if (expandDonne) {
  // On evalue une ligne de type "product" : les lignes "text" sont des titres de
  // section (ex : "FAÇADE SUD") sans prix ni quantite, ce qui est normal.
  const premiere =
    lignes.find((l) => pick(l, ['type']) === 'product') ??
    lignes.find((l) => pick(l, ['description', 'name', 'label'])) ??
    lignes[0]
  const aDesc = !!stripHtml(pick(premiere, ['description', 'name', 'label', 'title', 'text']))
  const aPrix = pick(premiere, ['sellPrice', 'unitPrice', 'unit_price', 'price', 'sellingPrice', 'amount']) != null
  const aQte = pick(premiere, ['quantity', 'qty', 'quantite']) != null
  // La TVA peut legitimement etre null sur un devis non assujetti (art. 293 B du
  // CGI). Sa presence/absence ne fait donc PAS echouer le verdict global.
  const aTva = pick(premiere, ['tax', 'taxRate', 'tax_rate', 'vat', 'vatRate', 'tva']) != null
  const nbProduits = lignes.filter((l) => pick(l, ['type']) === 'product').length
  console.log(`  _expand=lines remonte des lignes : OUI (.${champ}, ${lignes.length} lignes dont ${nbProduits} produits)`)
  console.log(`  Baseline sans le param avait deja des lignes : ${baseAvait ? 'OUI' : 'NON'}`)
  console.log(`  Champs presents sur la 1re ligne produit :`)
  console.log(`    description : ${aDesc ? 'OUI' : 'NON'}`)
  console.log(`    prix unit.  : ${aPrix ? 'OUI' : 'NON'}`)
  console.log(`    quantite    : ${aQte ? 'OUI' : 'NON'}`)
  console.log(`    tva         : ${aTva ? 'OUI' : 'NON (peut etre null si non assujetti)'}`)
  const complet = aDesc && aPrix && aQte
  console.log(
    `\n  ==> ${complet ? 'VALIDE : detail des lignes (description + prix + quantite) recupere.' : 'PARTIEL : lignes presentes mais un champ essentiel manque (voir ci-dessus).'}`,
  )
  if (!baseAvait) {
    console.log('  ==> Le param _expand=lines est bien ce qui declenche les lignes.')
  }
} else {
  console.log('  _expand=lines NE remonte PAS de lignes exploitables.')
  console.log('  ==> STOP : on documente ce retour et on bascule sur extraction PDF.')
}
