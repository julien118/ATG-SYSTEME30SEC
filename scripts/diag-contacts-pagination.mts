// Diagnostic LECTURE SEULE de la pagination /contacts sur le compte test Julien.
// Objectif : determiner combien de contacts l'API renvoie selon le parametre de
// limite, et inspecter les 10 contacts visibles vs la liste complete.
// Rappel piege #12 : les meta-params Costructor sans underscore sont ignores,
// /quotes est plafonne a 10 sans `_limit`. On verifie si /contacts fait pareil.
//
// AUCUNE ECRITURE : que des GET sur le compte de Julien (COSTRUCTOR_API_KEY).
// Lancer : npx tsx --env-file=.env.local scripts/diag-contacts-pagination.mts

const BASE_URL =
  process.env.COSTRUCTOR_API_BASE_URL || 'https://api.costructor.co/external/v1'
const KEY = process.env.COSTRUCTOR_API_KEY
const KEY_OLIVIER = process.env.COSTRUCTOR_API_KEY_OLIVIER

if (!KEY) {
  console.error('COSTRUCTOR_API_KEY (compte test Julien) manquante dans .env.local')
  process.exit(1)
}
if (KEY_OLIVIER && KEY === KEY_OLIVIER) {
  console.error('STOP : COSTRUCTOR_API_KEY == COSTRUCTOR_API_KEY_OLIVIER. Abandon.')
  process.exit(1)
}
console.log(`Compte cible (lecture) : cle ...${KEY.slice(-6)}\n`)

interface Contact {
  id: string
  fullName: string | null
  lastName: string | null
  companyName: string | null
  email: string | null
  phone: string | null
  emails?: { email: string }[]
  phones?: { phone: string }[]
}

async function lister(path: string): Promise<Contact[]> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    console.log(`  ${path} -> HTTP ${res.status}`)
    return []
  }
  const json = (await res.json()) as { data?: Contact[] }
  return Array.isArray(json.data) ? json.data : (json as unknown as Contact[])
}

// 1) Comptages comparatifs
console.log('== Comptages ==')
for (const v of ['/contacts', '/contacts?limit=1000', '/contacts?_limit=1000']) {
  const n = (await lister(v)).length
  console.log(`  ${v.padEnd(28)} -> ${n} contacts`)
}

// 2) Les 10 contacts VISIBLES par listerContacts() actuel (?limit=1000 ignore)
console.log('\n== 10 contacts visibles (etat actuel, ?limit=1000) ==')
const visibles = await lister('/contacts?limit=1000')
for (const c of visibles) {
  const nom = c.fullName || c.companyName || c.lastName || '(sans nom)'
  const email = c.email || c.emails?.[0]?.email || '-'
  console.log(`  ${c.id.slice(-6)}  ${nom.padEnd(22)} ${email}`)
}

// 3) Presence des temoins (Test 001 / 149 / 251) dans la liste COMPLETE
console.log('\n== Temoins dans la liste complete (_limit) ==')
const complet = await lister('/contacts?_limit=1000')
for (const cible of ['client001@test.local', 'client149@test.local', 'client251@test.local']) {
  const trouve = complet.find(
    (c) =>
      (c.email || '').toLowerCase() === cible ||
      (c.emails ?? []).some((e) => (e.email || '').toLowerCase() === cible),
  )
  const dansVisibles = visibles.find(
    (c) =>
      (c.email || '').toLowerCase() === cible ||
      (c.emails ?? []).some((e) => (e.email || '').toLowerCase() === cible),
  )
  console.log(
    `  ${cible.padEnd(26)} complet=${trouve ? 'OUI (' + trouve.id.slice(-6) + ')' : 'NON'}  visible10=${dansVisibles ? 'OUI' : 'NON'}`,
  )
}

// 4) Test 900 doit etre ABSENT (cible de creation Cas B)
const t900 = complet.find(
  (c) =>
    (c.email || '').toLowerCase() === 'client900@test.local' ||
    (c.emails ?? []).some((e) => (e.email || '').toLowerCase() === 'client900@test.local'),
)
console.log(`\n  client900@test.local present ? ${t900 ? 'OUI (' + t900.id.slice(-6) + ')' : 'NON (bon pour Cas B)'}`)
