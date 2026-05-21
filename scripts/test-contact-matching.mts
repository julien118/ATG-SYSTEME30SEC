// Test E2E du matching contact Costructor sur le compte démo.
// Scénarios :
//   1. email match     (Jean Dupont-TestAPI)
//   2. téléphone match (Jean Dupont-TestAPI via +33600000000)
//   3. nom match       (M. et Mme Dupont)
//   4. création        (Résidence Charles Daquin — nouveau contact)
// Lancer : npx tsx --env-file=.env.local scripts/test-contact-matching.mts

import { trouverOuCreerContact } from '../lib/costructor'

const scenarios = [
  {
    label: '1. email match',
    input: {
      client_nom: 'Peu importe',
      client_email: 'JEAN.DUPONT.TEST@ionnyx-api-test.fr', // casse différente exprès
      client_telephone: null,
      client_adresse: null,
    },
    expectMatchType: 'email',
  },
  {
    label: '2. phone match (format FR national au lieu de +33)',
    input: {
      client_nom: 'Peu importe non plus',
      client_email: null,
      client_telephone: '06 00 00 00 00', // doit matcher +33600000000
      client_adresse: null,
    },
    expectMatchType: 'phone',
  },
  {
    label: '3. nom match',
    input: {
      client_nom: 'm. et mme dupont', // casse minuscule
      client_email: null,
      client_telephone: null,
      client_adresse: null,
    },
    expectMatchType: 'nom',
  },
  {
    label: '4. création (nom unique + adresse parsée)',
    input: {
      client_nom: `Test Création ${new Date().toISOString().slice(0, 19)}`,
      client_email: null,
      client_telephone: null,
      client_adresse: '7 Rue Marie de Luxembourg 41100 Vendôme',
    },
    expectMatchType: 'created',
  },
] as const

for (const s of scenarios) {
  try {
    const res = await trouverOuCreerContact(s.input)
    const ok = res.matchType === s.expectMatchType
    console.log(
      `${ok ? '✅' : '❌'} ${s.label}\n   matchType=${res.matchType}  contactId=${res.contactId}  cree=${res.cree}`,
    )
    if (!ok) {
      console.log(`   (attendu : ${s.expectMatchType})`)
    }
  } catch (e) {
    console.log(`❌ ${s.label}\n   ERREUR : ${(e as Error).message}`)
  }
}
