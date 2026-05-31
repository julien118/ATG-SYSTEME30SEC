// =============================================================
// Phase F — re-test LIVE de la dedup apres correctifs T1..T4 (compte test Julien)
// =============================================================
// Regles de securite :
//   - Compte d'Olivier JAMAIS touche (aucune ref a COSTRUCTOR_API_KEY_OLIVIER).
//   - Toutes les ecritures sur le compte test de Julien (COSTRUCTOR_API_KEY),
//     protegees par assertCompteJulien() (dans la fonction elle-meme).
//   - Contacts 100% synthetiques. DELETE /contacts = 405 -> on garde des
//     identites FIXES pour rester idempotent (un re-run ne cree pas de doublon).
//
// Lancer : npx tsx --env-file=.env.local scripts/test-phase-f-dedup.mts

import { trouverOuCreerContact } from '../lib/costructor'

const BASE_URL =
  process.env.COSTRUCTOR_API_BASE_URL || 'https://api.costructor.co/external/v1'
const KEY = process.env.COSTRUCTOR_API_KEY!
const KEY_OLIVIER = process.env.COSTRUCTOR_API_KEY_OLIVIER
if (!KEY) throw new Error('COSTRUCTOR_API_KEY (Julien) manquante.')
if (KEY_OLIVIER && KEY === KEY_OLIVIER)
  throw new Error('STOP : la cle active est celle d\'Olivier. Abandon.')

const ok = (c: boolean, label: string, detail = '') =>
  console.log(`${c ? '✅' : '❌'} ${label}${detail ? `  (${detail})` : ''}`)

interface ContactBrut {
  id: string
  fullName: string | null
  email: string | null
  emails?: { email: string }[]
  phones?: { phone: string }[]
  addresses?: { address: { city?: string; postal_code?: string } | null }[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Backoff sur 429 (rate-limit Costructor) : le test enchaine beaucoup de GET de
// 300 contacts. On reessaie avec attente croissante.
async function retry<T>(fn: () => Promise<T>): Promise<T> {
  let derniere: unknown
  for (let i = 0; i < 6; i++) {
    try {
      return await fn()
    } catch (e) {
      derniere = e
      if (String((e as Error).message).includes('429')) {
        await sleep(2000 * (i + 1))
        continue
      }
      throw e
    }
  }
  throw derniere
}

async function getJulien<T>(path: string): Promise<T> {
  return retry(async () => {
    const r = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
    })
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`)
    const j = (await r.json()) as { data?: T } & T
    return (j.data !== undefined ? j.data : j) as T
  })
}

const nEmail = (s?: string | null) => (s ?? '').trim().toLowerCase()
const compter = async () => (await getJulien<ContactBrut[]>('/contacts?_limit=1000')).length

async function main() {
  console.log('\n################  PHASE F — RE-TEST LIVE (apres T1..T4)  ################\n')

  const complet = await getJulien<ContactBrut[]>('/contacts?_limit=1000')
  const avant = complet.length
  console.log(`Contacts (liste complete _limit) AVANT session : ${avant}`)

  const t001 = complet.find(
    (c) => nEmail(c.email) === 'client001@test.local' || (c.emails ?? []).some((e) => nEmail(e.email) === 'client001@test.local'),
  )
  if (!t001) throw new Error('Test 001 introuvable.')
  const villeT001 = t001.addresses?.[0]?.address?.city
  const cpT001 = t001.addresses?.[0]?.address?.postal_code
  console.log(`Temoin Test 001 : ...${t001.id.slice(-6)} | "${t001.fullName}" | ${villeT001} ${cpT001}\n`)

  // ---------- CAS A (LIVE) : contact existant retrouve, zero doublon ----------
  console.log('---------- CAS A (live) : Test 001 deja present ----------')
  const cAvant = await compter()
  const rA = await retry(() => trouverOuCreerContact({
    client_nom: 'Peu importe', client_email: 'client001@test.local', client_telephone: null, client_adresse: null,
  }))
  const cApres = await compter()
  ok(rA.matchType === 'email' && rA.contactId === t001.id && !rA.cree, 'Test 001 RETROUVE par email (pas de creation)', `matchType=${rA.matchType} cree=${rA.cree}`)
  ok(cApres === cAvant, 'Nombre de contacts INCHANGE (pas de doublon)', `avant=${cAvant} apres=${cApres}`)

  // ---------- CAS email casse differente ----------
  console.log('\n---------- CAS email casse differente ----------')
  await sleep(800)
  const cAvant2 = await compter()
  const rE = await retry(() => trouverOuCreerContact({
    client_nom: 'Zzz', client_email: '  CLIENT001@TEST.LOCAL  ', client_telephone: null, client_adresse: null,
  }))
  const cApres2 = await compter()
  ok(rE.matchType === 'email' && rE.contactId === t001.id, 'Match email robuste a la casse/aux espaces', `matchType=${rE.matchType}`)
  ok(cApres2 === cAvant2, 'Nombre de contacts inchange', `avant=${cAvant2} apres=${cApres2}`)

  // ---------- CAS telephone format francais "06 12 34 56 78" (T2) ----------
  console.log('\n---------- CAS telephone format francais (T2) ----------')
  // Identite FIXE (idempotente) : Test 901.
  await sleep(800)
  const rTel = await retry(() => trouverOuCreerContact({
    client_nom: 'Test 901', client_email: 'client901@test.local',
    client_telephone: '06 12 34 56 78', client_adresse: '901 rue des Tests 37000 Tours',
  }))
  ok(!!rTel.contactId, `Creation/recuperation SANS erreur 400 (matchType=${rTel.matchType})`, rTel.cree ? 'cree' : 'deja present, reutilise')
  const c901 = await getJulien<ContactBrut>(`/contacts/${rTel.contactId}`)
  const telStocke = c901.phones?.[0]?.phone ?? ''
  ok(telStocke === '0612345678', 'Telephone stocke assaini (chiffres, 0 de tete preserve)', `stocke="${telStocke}"`)
  ok(Array.isArray(c901.phones) && c901.phones.length > 0, 'phones en array')

  // ---------- CAS homonyme : meme nom, ville/CP differents -> PAS de fusion (T4) ----------
  console.log('\n---------- CAS homonyme (T4 : meme nom, CP/ville differents) ----------')
  // On reprend EXACTEMENT le nom de Test 001 mais a Paris 75001, email inedit fixe.
  await sleep(800)
  const rHom = await retry(() => trouverOuCreerContact({
    client_nom: t001.fullName ?? 'Test 001 Client',
    client_email: 'homonyme-001-paris@test.local',
    client_telephone: null,
    client_adresse: '5 rue de Paris 75001 Paris',
  }))
  ok(rHom.contactId !== t001.id, 'Homonyme NON fusionne avec Test 001 (contact distinct)', `homonyme=...${rHom.contactId.slice(-6)} vs test001=...${t001.id.slice(-6)}`)
  console.log(`   (matchType=${rHom.matchType} : ${rHom.cree ? 'nouveau contact cree' : 'retrouve par email au re-run, toujours distinct de Test 001'})`)

  // ---------- CONTROLE doublons : nom homonyme present sans concordance -> jamais Test 001 ----------
  // Verification supplementaire : un meme nom SANS adresse ne doit pas matcher Test 001 par nom.
  console.log('\n---------- CAS nom seul sans second critere -> pas de fusion ----------')
  // Lecture seule de la logique : on n'ecrit pas (sinon on creerait un contact a chaque run).
  // On verifie via la fonction en lui donnant le nom de Test 001 sans email/tel/adresse :
  // attendu = creation (matchType created) car aucun second critere. Pour NE PAS polluer,
  // on ne l'execute pas en ecriture ; on documente le comportement dans le rapport.
  console.log('   (non execute en ecriture pour ne pas creer de contact ; comportement attendu = creation, valide par la logique T4)')

  const apres = await compter()
  console.log('\n################  BILAN CONTACTS  ################')
  console.log(`AVANT session : ${avant}`)
  console.log(`APRES session : ${apres}`)
  console.log(`Delta : ${apres - avant} (= contacts synthetiques de test crees a dessein : Test 901 + homonyme Paris au 1er run ; 0 au re-run)`)
  console.log('\n################  FIN  ################\n')
}

main().catch((e) => {
  console.error('\n❌ ERREUR :', e)
  process.exit(1)
})
