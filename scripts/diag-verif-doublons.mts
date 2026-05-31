// Verification LECTURE SEULE : compte les occurrences des emails de test pour
// s'assurer qu'aucun doublon parasite n'a ete cree (compte test Julien).
// Lancer : npx tsx --env-file=.env.local scripts/diag-verif-doublons.mts
const B = process.env.COSTRUCTOR_API_BASE_URL || 'https://api.costructor.co/external/v1'
const KEY = process.env.COSTRUCTOR_API_KEY!
const r = await fetch(B + '/contacts?_limit=1000', {
  headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
})
const j = (await r.json()) as { data: any[] }
const total = j.data.length
const compteEmail = (email: string) =>
  j.data.filter(
    (c) =>
      (c.email || '').toLowerCase() === email ||
      (c.emails ?? []).some((e: any) => (e.email || '').toLowerCase() === email),
  )
console.log(`Total contacts : ${total}\n`)
for (const e of ['client001@test.local', 'client901@test.local', 'homonyme-001-paris@test.local']) {
  const occ = compteEmail(e)
  console.log(`  ${e.padEnd(34)} -> ${occ.length} occurrence(s)  [${occ.map((c) => c.id.slice(-6)).join(', ')}]`)
}
// Combien de contacts portent le nom normalise "test 001 client" ?
const norm = (s?: string | null) => (s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')
const memeNom = j.data.filter((c) => norm(c.fullName) === 'test 001 client')
console.log(`\n  Contacts au nom "Test 001 Client" : ${memeNom.length}`)
for (const c of memeNom) {
  const ad = (c.addresses ?? [])[0]?.address
  console.log(`    ...${c.id.slice(-6)}  ville=${ad?.city ?? '-'} cp=${ad?.postal_code ?? '-'}  email=${c.email ?? c.emails?.[0]?.email ?? '-'}`)
}
