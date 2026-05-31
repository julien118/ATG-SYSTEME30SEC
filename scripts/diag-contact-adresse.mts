// Sonde LECTURE SEULE : forme du champ adresse d'un contact (compte test Julien).
// Lancer : npx tsx --env-file=.env.local scripts/diag-contact-adresse.mts
const B = process.env.COSTRUCTOR_API_BASE_URL || 'https://api.costructor.co/external/v1'
const KEY = process.env.COSTRUCTOR_API_KEY!
const r = await fetch(B + '/contacts?_limit=1000', {
  headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
})
const j = (await r.json()) as { data: any[] }
const c = j.data.find((x) => (x.email || '').toLowerCase() === 'client001@test.local')
console.log('Cles du contact :', Object.keys(c).join(', '))
console.log('\naddresses =', JSON.stringify(c.addresses ?? c.address ?? null, null, 2))
