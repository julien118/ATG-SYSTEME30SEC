// =============================================================
// Non-regression : jonction CLIENT (trouverOuCreerContact) + DEVIS rattache
// =============================================================
// Confirme qu'apres les changements de costructor.ts (T1..T4 + garde-fou
// partage), la chaine contact -> devis brouillon rattache fonctionne toujours.
// Compte test Julien uniquement, contact synthetique reutilise (Test 901),
// brouillon supprime en fin de test.
//
// Lancer : npx tsx --env-file=.env.local scripts/test-chaine-client-devis.mts

import { trouverOuCreerContact, supprimerDevis } from '../lib/costructor'
import { selectionnerModele, type ModeleDevis } from '../lib/atg-routing'
import {
  assertCompteJulien,
  bannerCompte,
  construirePayloadDepuisModele,
  extraireMetres,
  getModeleExpand,
  listerModeles,
  listerProduitsPlats,
  pousserDevisGroupe,
} from '../lib/atg-devis-modele'

const BASE_URL =
  process.env.COSTRUCTOR_API_BASE_URL || 'https://api.costructor.co/external/v1'
const KEY = process.env.COSTRUCTOR_API_KEY!
const KEY_OLIVIER = process.env.COSTRUCTOR_API_KEY_OLIVIER
if (!KEY) throw new Error('COSTRUCTOR_API_KEY (Julien) manquante.')
if (KEY_OLIVIER && KEY === KEY_OLIVIER)
  throw new Error('STOP : la cle active est celle d\'Olivier.')

const ok = (c: boolean, label: string, detail = '') =>
  console.log(`${c ? '✅' : '❌'} ${label}${detail ? `  (${detail})` : ''}`)

async function getJulien<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`)
  const j = (await r.json()) as { data?: T } & T
  return (j.data !== undefined ? j.data : j) as T
}

async function main() {
  console.log('\n########  NON-REGRESSION CHAINE CLIENT + DEVIS  ########\n')

  // 1) CLIENT via trouverOuCreerContact (Test 901 existe -> retrouve, pas de doublon)
  console.log('---------- 1) Contact via trouverOuCreerContact ----------')
  const contact = await trouverOuCreerContact({
    client_nom: 'Test 901',
    client_email: 'client901@test.local',
    client_telephone: '06 12 34 56 78',
    client_adresse: '901 rue des Tests 37000 Tours',
  })
  ok(!!contact.contactId, `Contact obtenu (matchType=${contact.matchType}, cree=${contact.cree})`, contact.contactId)

  // 2) DEVIS I3 peinture genere et rattache a ce contact
  console.log('\n---------- 2) Devis I3 peinture rattache ----------')
  const DICTEE = `Ravalement I3 peinture, deux facades. Facade Sud 40 metres carres, dessous de toit 12 metres, appuis 6 metres. Facade Nord 38 metres carres, dessous de toit 12 metres. Echafaudage sur l'ensemble 90 metres carres. Lavage et traitement algicide sur toutes les facades.`
  bannerCompte('LECTURE')
  const modelesRaw = await listerModeles()
  const modeles: ModeleDevis[] = modelesRaw.map((m: any) => ({
    id: m.id, name: m.name ?? null, description: m.description ?? null, total: m.total ?? null, model: !!m.model,
  }))
  const routage = selectionnerModele(DICTEE, modeles)
  ok(routage.typologie === 'ravalement_i3_peinture', `Routing -> ${routage.typologie}`)
  if (!routage.modeleId) throw new Error('Pas de modele route.')

  const modele = await getModeleExpand(routage.modeleId)
  const produits = await listerProduitsPlats()
  const metres = await extraireMetres(DICTEE)
  const construit = construirePayloadDepuisModele(modele.lines, metres, produits)
  console.log(`  Payload : ${construit.lines.length} lignes racine | total attendu ${(construit.totalAttenduCentimes / 100).toFixed(2)} € HT`)

  assertCompteJulien()
  bannerCompte('ÉCRITURE')
  const devis = await pousserDevisGroupe({
    customer: contact.contactId,
    description: 'NON-REGRESSION - chaine client+devis (brouillon)',
    lines: construit.lines,
  })
  console.log(`  Devis cree : ${devis.id} | total renvoye ${devis.total} c`)

  // 3) Verification : rattachement contact + total racine
  console.log('\n---------- 3) Verification jonction ----------')
  const relu = await getJulien<any>(`/quotes/${devis.id}?_expand=customer`)
  const customerId =
    typeof relu.customer === 'string' ? relu.customer : relu.customer?.id ?? relu.customerId
  ok(customerId === contact.contactId, 'Devis rattache au BON contact', `relu=${customerId} attendu=${contact.contactId}`)
  ok(relu.subtotal === construit.totalAttenduCentimes, 'Total racine == total attendu', `${relu.subtotal} vs ${construit.totalAttenduCentimes}`)

  // 4) Nettoyage du brouillon de test
  await supprimerDevis(devis.id)
  console.log(`\n  Brouillon de test supprime (${devis.id}).`)
  console.log('\n########  FIN  ########\n')
}

main().catch((e) => {
  console.error('\n❌ ERREUR :', e)
  process.exit(1)
})
