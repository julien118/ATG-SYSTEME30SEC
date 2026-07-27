// Test unitaire de parseNomClient (aucune API). Vérifie le correctif « M.mme [NOM] ».
// Lancer : npx tsx scripts/test-parse-nom-client.mts
import { parseNomClient } from '../lib/costructor'

type Attendu = { civility?: string; firstName: string; lastName: string }
const cas: Array<{ in: string; out: Attendu }> = [
  // Le cas d'Olivier : couple collé
  { in: 'M.mme Hosselet', out: { civility: 'mf', firstName: '', lastName: 'Hosselet' } },
  // Couples, variantes d'écriture
  { in: 'M. et Mme Dupont', out: { civility: 'mf', firstName: '', lastName: 'Dupont' } },
  { in: 'M et Mme Dupont', out: { civility: 'mf', firstName: '', lastName: 'Dupont' } },
  { in: 'Monsieur et Madame Martin', out: { civility: 'mf', firstName: '', lastName: 'Martin' } },
  { in: 'M & Mme Bernard', out: { civility: 'mf', firstName: '', lastName: 'Bernard' } },
  { in: 'Mme et M. Petit', out: { civility: 'fm', firstName: '', lastName: 'Petit' } },
  // Singuliers sans prénom → nom seul
  { in: 'M. Durand', out: { civility: 'm', firstName: '', lastName: 'Durand' } },
  { in: 'Mme Leroy', out: { civility: 'f', firstName: '', lastName: 'Leroy' } },
  { in: 'Mlle Robert', out: { civility: 'f', firstName: '', lastName: 'Robert' } },
  // Singuliers AVEC prénom (2 mots) → split prénom/nom
  { in: 'M. Jean Dupont', out: { civility: 'm', firstName: 'Jean', lastName: 'Dupont' } },
  { in: 'Madame Sophie Martin', out: { civility: 'f', firstName: 'Sophie', lastName: 'Martin' } },
  { in: 'Monsieur Jean-Pierre Blanc', out: { civility: 'm', firstName: 'Jean-Pierre', lastName: 'Blanc' } },
  // Singulier + 3 mots → PAS de split (prudence), tout dans lastName
  { in: 'M. Jean Paul Dupont', out: { civility: 'm', firstName: '', lastName: 'Jean Paul Dupont' } },
  // Couple + prénom → jamais de split, tout dans lastName
  { in: 'M. et Mme Jean Dupont', out: { civility: 'mf', firstName: '', lastName: 'Jean Dupont' } },
  // Pluriels
  { in: 'MM. Dupont', out: { civility: 'mm', firstName: '', lastName: 'Dupont' } },
  { in: 'Mmes Durand', out: { civility: 'ff', firstName: '', lastName: 'Durand' } },
  // SANS civilité → comportement inchangé (tout dans lastName, casse/points intacts)
  { in: 'Daquin Résidence Charles', out: { firstName: '', lastName: 'Daquin Résidence Charles' } },
  { in: 'Jean Dupont', out: { firstName: '', lastName: 'Jean Dupont' } },
  { in: 'SARL Bâti Pro', out: { firstName: '', lastName: 'SARL Bâti Pro' } },
  { in: 'S.A.S. Construction', out: { firstName: '', lastName: 'S.A.S. Construction' } },
  { in: 'Résidence Les Tilleuls', out: { firstName: '', lastName: 'Résidence Les Tilleuls' } },
  // "et Compagnie" ne doit pas être pris pour une civilité
  { in: 'Etablissements Moreau', out: { firstName: '', lastName: 'Etablissements Moreau' } },
  // Vide
  { in: '   ', out: { firstName: '', lastName: '' } },
]

let ko = 0
for (const c of cas) {
  const r = parseNomClient(c.in)
  const ok =
    (r.civility ?? undefined) === (c.out.civility ?? undefined) &&
    r.firstName === c.out.firstName &&
    r.lastName === c.out.lastName
  if (!ok) ko++
  console.log(
    `${ok ? '✅' : '❌'} ${JSON.stringify(c.in).padEnd(34)} → civility=${JSON.stringify(r.civility)} first=${JSON.stringify(r.firstName)} last=${JSON.stringify(r.lastName)}`,
  )
  if (!ok) console.log(`   attendu: civility=${JSON.stringify(c.out.civility)} first=${JSON.stringify(c.out.firstName)} last=${JSON.stringify(c.out.lastName)}`)
}
console.log(`\n${cas.length - ko}/${cas.length} OK` + (ko ? ` — ${ko} ÉCHEC(S)` : ' — tout passe ✅'))
if (ko) process.exit(1)
