// =============================================================
// Tache 2 — Extraire les devis de ravalement d'Olivier (compte SOURCE ATG)
// =============================================================
// LECTURE SEULE : uniquement des GET, aucune ecriture sur le compte d'Olivier.
// Recupere tous les devis avec _expand=lines, filtre les devis de ravalement de
// facade, garde les 8 a 10 plus complets et les sauve dans data/devis-olivier/.
//
// Schema de ligne valide en Tache 1 :
//   type ('text'|'product'), position, description (HTML), sellPrice (centimes),
//   sellPriceDecimal, quantity, unit {id,name,symbol}, product {id,name},
//   taxRate, tax, subtotal, total.
//
// Lancement : node --env-file=.env.local pull-devis-olivier.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE =
  process.env.COSTRUCTOR_API_BASE_URL || 'https://api.costructor.co/external/v1'

// Cle du compte SOURCE d'Olivier UNIQUEMENT. Pas de repli sur la cle de Julien :
// on veut explicitement aspirer les vrais devis d'Olivier.
const KEY = process.env.COSTRUCTOR_API_KEY_OLIVIER
if (!KEY) {
  console.error(
    'Cle manquante : definir COSTRUCTOR_API_KEY_OLIVIER dans .env.local (compte SOURCE ATG).',
  )
  console.error('Cette cle est distincte de COSTRUCTOR_API_KEY (compte de test Julien).')
  process.exit(1)
}

const DOSSIER = join(process.cwd(), 'data', 'devis-olivier')
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

function unwrap(env) {
  if (env && typeof env === 'object' && 'data' in env) return env.data
  return env
}
function asArray(v) {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object' && Array.isArray(v.data)) return v.data
  return []
}

// Normalise pour comparaison : minuscules, sans accents.
function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}
function stripHtml(s) {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
function slug(s) {
  return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

// Mots-cles ravalement de facade (deja normalises, sans accents).
const MOTS_CLES = [
  'ravalement',
  'facade',
  'enduit',
  'impermeabil',
  'hydrofuge',
  'crepi',
  ' ite ',
  'isolation thermique par l-exterieur',
  'isolation thermique par l exterieur',
  'pignon',
]
// Mots-cles facade/pignon pour compter les sections facade (multi-facades).
const MOTS_FACADE = ['facade', 'pignon']

// Concatene tout le texte pertinent d'un devis pour le matching.
function texteDevis(d) {
  const morceaux = [
    d.name,
    d.description,
    d.projectLabel,
    d.title,
    d.project && d.project.name,
    d.project && d.project.label,
  ]
  for (const l of d.lines ?? []) {
    morceaux.push(stripHtml(l.description))
    if (l.product && l.product.name) morceaux.push(l.product.name)
  }
  return norm(morceaux.filter(Boolean).join(' · '))
}

function estRavalement(d) {
  const t = ' ' + texteDevis(d) + ' '
  return MOTS_CLES.some((kw) => t.includes(kw))
}

function nbProduits(d) {
  return (d.lines ?? []).filter((l) => l.type === 'product').length
}
// Nombre de titres de section facade/pignon (proxy "multi-facades").
function nbFacades(d) {
  return (d.lines ?? []).filter(
    (l) => l.type === 'text' && MOTS_FACADE.some((kw) => norm(l.description).includes(kw)),
  ).length
}

// =============================================================
console.log('=============================================================')
console.log("Tache 2 — extraction des devis de ravalement d'Olivier")
console.log(`Base : ${BASE}`)
console.log('=============================================================\n')

// IMPORTANT : l'API Costructor utilise des meta-params PREFIXES PAR UNDERSCORE.
// `limit`/`offset`/`page` (sans underscore) sont IGNORES et la liste est plafonnee
// a 10. Seuls `_limit`, `_page`, `_expand`, `_sort`, `_order` sont honores
// (valide 2026-05-28 sur le compte de test). On force donc `_limit` eleve.
console.log('[1] GET /quotes?_expand=lines&_limit=1000')
const liste = await get('/quotes?_expand=lines&_limit=1000')
console.log(`    -> HTTP ${liste.status} ${liste.statusText}`)
if (liste.status !== 200) {
  console.error(
    typeof liste.body === 'string' ? liste.body : JSON.stringify(liste.body, null, 2),
  )
  process.exit(1)
}

const tous = asArray(unwrap(liste.body))
// metadata.items donne le total reel cote serveur : on verifie qu'on a tout recu.
const totalServeur =
  liste.body && liste.body.metadata && liste.body.metadata.items
console.log(`    -> ${tous.length} devis recuperes` + (totalServeur ? ` (total compte : ${totalServeur})` : ''))
if (totalServeur && tous.length < totalServeur) {
  console.warn(
    `    !! ATTENTION : ${tous.length}/${totalServeur} devis seulement. La pagination _limit n'a pas tout remonte.`,
  )
  console.warn('    !! Augmenter _limit ou paginer via _page avant de se fier a la selection.')
}

// On ecarte les modeles et les devis sans lignes.
const exploitables = tous.filter((d) => !d.model && nbProduits(d) > 0)
console.log(`    -> ${exploitables.length} devis exploitables (non-modeles, avec lignes produit)`)

// Filtre ravalement de facade.
const ravalement = exploitables.filter(estRavalement)
console.log(`    -> ${ravalement.length} devis identifies "ravalement de facade"`)

// Dedoublonnage par numero : un meme devis a souvent plusieurs revisions
// (meme `number`). On garde la plus complete (plus de lignes produit, sinon
// total le plus eleve) pour maximiser la diversite de l'echantillon de style.
const parNumero = new Map()
for (const d of ravalement) {
  const cle = d.number || d.id
  const actuel = parNumero.get(cle)
  if (
    !actuel ||
    nbProduits(d) > nbProduits(actuel) ||
    (nbProduits(d) === nbProduits(actuel) && (d.total ?? 0) > (actuel.total ?? 0))
  ) {
    parNumero.set(cle, d)
  }
}
const distincts = [...parNumero.values()]
console.log(`    -> ${distincts.length} devis distincts apres dedoublonnage par numero`)

// Tri par representativite : multi-facades, puis nb de produits, puis total.
distincts.sort((a, b) => {
  if (nbFacades(b) !== nbFacades(a)) return nbFacades(b) - nbFacades(a)
  if (nbProduits(b) !== nbProduits(a)) return nbProduits(b) - nbProduits(a)
  return (b.total ?? 0) - (a.total ?? 0)
})

const NB_MAX = 10
const selection = distincts.slice(0, NB_MAX)
console.log(`    -> ${selection.length} devis selectionnes (les plus complets)\n`)

// Sauvegarde.
mkdirSync(DOSSIER, { recursive: true })

console.log('[2] Sauvegarde dans data/devis-olivier/')
const index = []
for (const d of selection) {
  const nomFichier = `${slug(d.number || d.id)}-${d.id}.json`
  writeFileSync(join(DOSSIER, nomFichier), JSON.stringify(d, null, 2), 'utf8')
  const resume = {
    id: d.id,
    number: d.number,
    description: d.description,
    issuedAt: d.issuedAt,
    status: d.status,
    nbFacades: nbFacades(d),
    nbProduits: nbProduits(d),
    nbLignes: (d.lines ?? []).length,
    totalCentimes: d.total,
    totalEuros: d.total != null ? Number(d.total) / 100 : null,
    fichier: nomFichier,
  }
  index.push(resume)
  console.log(
    `    - ${nomFichier}  (${resume.nbFacades} facade(s), ${resume.nbProduits} produits, ${resume.totalEuros} EUR)`,
  )
}

// Index recapitulatif (selection + apercu de tout le compte pour audit).
const apercuTout = tous.map((d) => ({
  id: d.id,
  number: d.number,
  model: !!d.model,
  description: d.description,
  nbProduits: nbProduits(d),
  nbFacades: nbFacades(d),
  ravalement: estRavalement(d),
  totalEuros: d.total != null ? Number(d.total) / 100 : null,
}))
writeFileSync(
  join(DOSSIER, '_index.json'),
  JSON.stringify({ selection: index, tousLesDevis: apercuTout }, null, 2),
  'utf8',
)
console.log(`    - _index.json  (recap selection + apercu des ${tous.length} devis)`)

console.log('\n==> Extraction terminee. Prochaine etape : synthese STYLE-OLIVIER.md.')
