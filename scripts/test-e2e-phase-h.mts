// =============================================================
// Phase H : verification de bout en bout de la chaine complete (compte test)
// =============================================================
// Simule le parcours reel d'un utilisateur, sans isoler les briques, sur 3 cas :
//   Cas 1 : ravalement I3 peinture, compte rendu attache, contact NOUVEAU.
//   Cas 2 : ITE detaillee, compte rendu attache, contact EXISTANT (dedup).
//   Cas 3 : ITE standard, SANS compte rendu (le devis se pousse sans lien casse).
//
// Chaine par cas : (1) persistance du PDF de compte rendu -> URL stable,
//   (2) resolution du contact (dedup ou creation), (3) routing + clonage du
//   modele + remplissage des metres, (4) push du devis en BROUILLON avec le lien
//   du compte rendu injecte, (5) verifications de coherence (contact, lien,
//   totaux, structure, TVA).
//
// REGLES ABSOLUES : compte d'Olivier en LECTURE SEULE STRICTE (aucune ecriture
// dans ce script) ; toutes les ecritures sur le compte test de Julien via
// assertCompteJulien() + banniere ; brouillons et contacts synthetiques (domaine
// example.test, 100% fictifs) uniquement.
//
// Lancer : npx tsx --env-file=.env.local scripts/test-e2e-phase-h.mts

import { createClient } from '@supabase/supabase-js'
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
import { listerContacts, trouverOuCreerContact } from '../lib/costructor'
import { persistRapportPdf, recupererUrlRapportPdf } from '../lib/rapport-pdf'

// ---------- Chantiers temoins (compte test) ----------
const CH_RAVALEMENT_CR = 'f0ff75dc-b2f6-4034-95b3-d6c417c84456' // Residence Charles Daquin
const CH_ITE_CR = '5729187c-37a4-479f-8935-1f25cb4f59a5' // Lotfi
const CH_SANS_CR = '0d02cca8-844a-4652-9735-9fc3f2f53be4' // Mr et Mme Martin (non persiste)

// ---------- Contacts synthetiques (domaine example.test, fictifs) ----------
const CONTACT_NOUVEAU = {
  client_nom: 'Phase H Ravalement Test',
  client_email: 'phaseh-ravalement@example.test',
  client_telephone: '0600000801',
  client_adresse: '12 rue des Essais 37000 Tours',
}
const CONTACT_EXISTANT = {
  client_nom: 'Phase H ITE Existant',
  client_email: 'phaseh-ite@example.test',
  client_telephone: '0600000802',
  client_adresse: '34 avenue du Clone 37100 Tours',
}
const CONTACT_SANS_CR = {
  client_nom: 'Phase H Sans CR',
  client_email: 'phaseh-sanscr@example.test',
  client_telephone: '0600000803',
  client_adresse: '56 boulevard du Test 37200 Tours',
}

interface CasConfig {
  cle: string
  titre: string
  dictee: string
  chantierId: string
  persisterCR: boolean
  familleAttendue: 'ravalement' | 'ite'
  contact: typeof CONTACT_NOUVEAU
  contactExistantAttendu: boolean
}

const CAS: CasConfig[] = [
  {
    cle: 'cas-1-ravalement-cr-nouveau',
    titre: 'Ravalement I3 peinture | CR attache | contact NOUVEAU',
    chantierId: CH_RAVALEMENT_CR,
    persisterCR: true,
    familleAttendue: 'ravalement',
    contact: CONTACT_NOUVEAU,
    contactExistantAttendu: false,
    dictee: `Ravalement I3 peinture sur la maison rue des Tilleuls, deux facades.
Facade Sud : 60 metres carres, dessous de toit 12 metres, appuis 8 metres.
Facade Nord : 40 metres carres, dessous de toit 12 metres.
Echafaudage sur l'ensemble, 100 metres carres. Lavage et traitement algicide.`,
  },
  {
    cle: 'cas-2-ite-cr-existant',
    titre: 'ITE detaillee | CR attache | contact EXISTANT (dedup)',
    chantierId: CH_ITE_CR,
    persisterCR: true,
    familleAttendue: 'ite',
    contact: CONTACT_EXISTANT,
    contactExistantAttendu: true,
    dictee: `Isolation thermique par l'exterieur, garantie decennale, polystyrene PSE 140 millimetres.
Facade Sud partie chauffee 80 metres carres, dessous de toit 15 metres, tableaux de fenetres isoles 20 metres, appuis 10 metres.
Trois jeux de volets battants a deposer et reposer. Un report d'eclairage et un report de robinet.
Echafaudage 80 metres carres, lavage et traitement.`,
  },
  {
    cle: 'cas-3-ite-sans-cr',
    titre: 'ITE standard | SANS compte rendu | pas de lien',
    chantierId: CH_SANS_CR,
    persisterCR: false,
    familleAttendue: 'ite',
    contact: CONTACT_SANS_CR,
    contactExistantAttendu: false,
    dictee: `Isolation thermique exterieure StarSystem, facade unique 50 metres carres, isolant PSE.
Echafaudage 50 metres carres. Lavage de la facade.`,
  },
]

// ---------- Utilitaires ----------
const strip = (s: string | null | undefined) =>
  (s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

let total = 0
let echecs = 0
const ok = (c: boolean, label: string, detail = '') => {
  total++
  if (!c) echecs++
  console.log(`${c ? '✅' : '❌'} ${label}${detail ? `  (${detail})` : ''}`)
}

// Stats de structure d'un arbre de devis relu (GET).
function statsArbre(lines: any[]): {
  groupes: string[]
  produits: number
  textes: number
  sommeRacine: number
  sommeTousProduits: number
} {
  const groupes: string[] = []
  let produits = 0, textes = 0, sommeTousProduits = 0
  const walk = (ls: any[]) => {
    for (const l of [...(ls ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
      if (l.type === 'group') { groupes.push(strip(l.description)); walk(l.lines) }
      else if (l.type === 'product') { produits++; sommeTousProduits += l.subtotal ?? 0 }
      else textes++
    }
  }
  walk(lines)
  const sommeRacine = [...(lines ?? [])].reduce((s, l) => s + (l.subtotal ?? 0), 0)
  return { groupes, produits, textes, sommeRacine, sommeTousProduits }
}

// Client Supabase service_role (compte test) pour les controles Storage.
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

async function occurrencesPdf(chantierId: string): Promise<number> {
  const { data } = await sb.storage.from('rapports').list('', { search: `${chantierId}.pdf` })
  return (data ?? []).filter((o) => o.name === `${chantierId}.pdf`).length
}

async function compterContactsParEmail(email: string): Promise<number> {
  const contacts = await listerContacts()
  const e = email.trim().toLowerCase()
  return contacts.filter((c) => {
    if ((c.email ?? '').trim().toLowerCase() === e) return true
    return (c.emails ?? []).some((x) => (x.email ?? '').trim().toLowerCase() === e)
  }).length
}

// ---------- Resultat d'un cas (pour le rapport de synthese) ----------
interface Resultat {
  cle: string
  titre: string
  contactType: string
  contactId: string
  typologie: string
  modeleId: string | null
  confiance: string
  totalCentimes: number
  lienPresent: boolean
  lienUrl: string | null
  taxable: boolean
  taxTotal: number
  totalCoherent: boolean
  ecarts: string[]
}

let modelesCache: ModeleDevis[] | null = null

// ---------- Parcours complet d'un cas ----------
async function journey(cfg: CasConfig): Promise<Resultat> {
  console.log(`\n================================================================`)
  console.log(`### ${cfg.titre}`)
  console.log(`================================================================`)
  const ecarts: string[] = []

  // (1) Compte rendu : persistance du PDF -> URL stable (ou non, cas 3).
  let urlCR: string | null = null
  if (cfg.persisterCR) {
    const p = await persistRapportPdf(cfg.chantierId)
    urlCR = p.url
    ok(p.path === `${cfg.chantierId}.pdf`, 'CR : PDF persiste au chemin deterministe', p.path)
    ok(p.taille > 5000, 'CR : PDF non vide', `${p.taille} o`)
  } else {
    const u = await recupererUrlRapportPdf(cfg.chantierId)
    ok(u === null, 'CR : aucun PDF persiste pour ce chantier (cas sans CR)', u ?? 'null')
  }

  // (2) Contact : dedup ou creation (ecriture compte test).
  assertCompteJulien()
  bannerCompte('ÉCRITURE')
  const contact = await trouverOuCreerContact(cfg.contact)
  console.log(`Contact : ${contact.matchType} -> ${contact.contactId}`)
  if (cfg.contactExistantAttendu) {
    ok(contact.matchType !== 'created', 'Contact EXISTANT retrouve par dedup (pas de creation)', contact.matchType)
  } else {
    ok(!!contact.contactId, 'Contact resolu (cree au 1er run, retrouve ensuite)', contact.matchType)
  }

  // (3) Routing + clonage + metres.
  if (!modelesCache) {
    const raw = await listerModeles()
    modelesCache = raw.map((m: any) => ({
      id: m.id, name: m.name ?? null, description: m.description ?? null,
      total: m.total ?? null, model: !!m.model,
    }))
  }
  const routage = selectionnerModele(cfg.dictee, modelesCache)
  console.log(`Routage : famille=${routage.famille} typologie=${routage.typologie} (${routage.confiance}) -> ${routage.modeleId}`)
  ok(routage.famille === cfg.familleAttendue, `Famille detectee = ${cfg.familleAttendue}`, routage.famille)
  ok(!!routage.modeleId, 'Un modele a ete selectionne')
  ok(routage.confiance !== 'aucune', `Confiance non nulle (${routage.confiance})`)
  if (!routage.modeleId) throw new Error('Routage sans modele : arret du cas.')

  const modele = await getModeleExpand(routage.modeleId)
  const produits = await listerProduitsPlats()
  const metres = await extraireMetres(cfg.dictee)
  const construit = construirePayloadDepuisModele(modele.lines, metres, produits)
  console.log(`Payload : ${construit.lines.length} lignes racine | total attendu ${(construit.totalAttenduCentimes / 100).toFixed(2)} € HT`)
  if (construit.nonResolus.length)
    console.log('  ⚠️ points non resolus (non ajoutes en silence) :', construit.nonResolus.map((p) => p.libelle).join(' | '))

  // (4) Push BROUILLON avec lien du compte rendu (ecriture compte test).
  assertCompteJulien()
  bannerCompte('ÉCRITURE')
  const cree = await pousserDevisGroupe({
    customer: contact.contactId,
    description: `Devis ${cfg.titre} (brouillon Phase H)`,
    lines: construit.lines,
    chantierId: cfg.chantierId,
  })
  console.log(`Brouillon cree : ${cree.id}`)

  // (5) Verifications de coherence (GET read-back).
  const relu = await getModeleExpand(cree.id)
  const s = statsArbre(relu.lines)

  // Contact rattache.
  ok(relu.customer?.id === contact.contactId, 'Devis rattache au bon contact', `${relu.customer?.id}`)

  // Lien du compte rendu.
  const desc = relu.description ?? ''
  const lienPresent = strip(desc).includes('Compte rendu de visite')
  if (cfg.persisterCR) {
    ok(lienPresent, 'Lien compte rendu present dans la description')
    ok(desc.includes(`href="${urlCR}"`), 'Lien (ancre HTML) pointe vers le bon PDF du chantier', (urlCR ?? '').slice(-30))
    ok((urlCR ?? '').includes(cfg.chantierId), 'URL du lien = celle de CE chantier (bon compte rendu)')
    const res = await fetch(urlCR!)
    const buf = Buffer.from(await res.arrayBuffer())
    ok(res.ok && buf.subarray(0, 4).toString('latin1') === '%PDF', 'Le lien ouvre un vrai PDF (HTTP 200 + %PDF)')
  } else {
    ok(!lienPresent, 'Aucun lien compte rendu (cas sans CR, pas de lien casse)')
  }

  // Totaux : niveau racine fait foi, pas de doublement via la vue imbriquee.
  ok(relu.subtotal === construit.totalAttenduCentimes, 'Total racine == total attendu (payload)', `${relu.subtotal} vs ${construit.totalAttenduCentimes}`)
  ok(s.sommeTousProduits === relu.subtotal, 'Somme des produits (chacun 1x) == subtotal racine (pas de doublement)', `${s.sommeTousProduits} vs ${relu.subtotal}`)
  const totalCoherent = relu.subtotal === construit.totalAttenduCentimes && s.sommeTousProduits === relu.subtotal

  // TVA : etat d'assujettissement et taux.
  const taxable = !!relu.taxable
  const taxTotal = relu.taxTotal ?? 0
  console.log(`TVA : taxable=${taxable} | taxTotal=${taxTotal} c | total=${relu.total} c`)
  if (!taxable || taxTotal === 0) {
    ecarts.push('TVA absente : devis non assujetti (taxable=false, taxTotal=0) alors que les travaux relevent de la TVA 10%.')
  }
  console.log(`Structure : ${s.groupes.length} groupes [${s.groupes.join(' | ')}] | ${s.produits} produits | ${s.textes} textes`)

  return {
    cle: cfg.cle,
    titre: cfg.titre,
    contactType: contact.matchType,
    contactId: contact.contactId,
    typologie: routage.typologie,
    modeleId: routage.modeleId,
    confiance: routage.confiance,
    totalCentimes: relu.subtotal,
    lienPresent,
    lienUrl: cfg.persisterCR ? urlCR : null,
    taxable,
    taxTotal,
    totalCoherent,
    ecarts,
  }
}

// ---------- Programme principal ----------
async function main() {
  console.log('\n##################  PHASE H - E2E CHAINE COMPLETE  ##################')

  // Garde-fou de session : la cle d'ecriture NE DOIT PAS etre celle d'Olivier.
  const keyJulien = process.env.COSTRUCTOR_API_KEY
  const keyOlivier = process.env.COSTRUCTOR_API_KEY_OLIVIER
  bannerCompte('LECTURE')
  ok(!!keyJulien, 'COSTRUCTOR_API_KEY (Julien) presente')
  ok(!keyOlivier || keyJulien !== keyOlivier, 'GARDE-FOU : la cle d\'ecriture n\'est PAS celle d\'Olivier')

  // Pre-seed du contact EXISTANT (cas 2) : on s'assure qu'il existe AVANT, pour
  // que la dedup le retrouve dans la chaine complete (idempotent : pas de doublon).
  assertCompteJulien()
  bannerCompte('ÉCRITURE')
  const seed = await trouverOuCreerContact(CONTACT_EXISTANT)
  console.log(`Pre-seed contact existant (cas 2) : ${seed.matchType} -> ${seed.contactId}`)

  // Deroule les 3 cas de bout en bout.
  const resultats: Resultat[] = []
  for (const cfg of CAS) {
    resultats.push(await journey(cfg))
  }

  // ---------- Controles transverses ----------
  console.log(`\n================================================================`)
  console.log('### CONTROLES TRANSVERSES')
  console.log(`================================================================`)

  // Idempotence contacts : un seul contact par email (pas de doublon cree).
  for (const c of [CONTACT_NOUVEAU, CONTACT_EXISTANT, CONTACT_SANS_CR]) {
    const n = await compterContactsParEmail(c.client_email)
    ok(n === 1, `Idempotence contact : 1 seul "${c.client_email}"`, `occurrences=${n}`)
  }

  // Dedup robuste : un re-resolve du contact NOUVEAU retrouve le meme id.
  const reA = await trouverOuCreerContact(CONTACT_NOUVEAU)
  ok(reA.matchType !== 'created', 'Dedup : re-resolution du contact nouveau = retrouve (pas recree)', reA.matchType)

  // Idempotence PDF : 1 seul objet par chantier persiste (pas d'accumulation).
  for (const ch of [CH_RAVALEMENT_CR, CH_ITE_CR]) {
    const n = await occurrencesPdf(ch)
    ok(n === 1, `Idempotence PDF : 1 seul objet ${ch.slice(0, 8)}….pdf`, `occurrences=${n}`)
  }

  // Garde-fou final : la cle utilisee par les ecritures reste celle de Julien.
  ok(assertCompteJulien() === keyJulien, 'GARDE-FOU : ecritures sur le compte Julien sur toute la session')

  // ---------- Rapport de synthese ----------
  console.log(`\n##################  RAPPORT DE SYNTHESE PHASE H  ##################\n`)
  for (const r of resultats) {
    console.log(`• ${r.titre}`)
    console.log(`   contact   : ${r.contactType} (${r.contactId})`)
    console.log(`   typologie : ${r.typologie} | modele ${r.modeleId} | confiance ${r.confiance}`)
    console.log(`   total     : ${(r.totalCentimes / 100).toFixed(2)} € HT (${r.totalCentimes} c) | coherent=${r.totalCoherent ? 'oui' : 'NON'}`)
    console.log(`   lien CR   : ${r.lienPresent ? 'present -> ' + r.lienUrl : 'absent (attendu pour ce cas)'}`)
    console.log(`   TVA       : taxable=${r.taxable} | taxTotal=${r.taxTotal} c`)
    if (r.ecarts.length) for (const e of r.ecarts) console.log(`   ⚠️ ecart : ${e}`)
    console.log()
  }

  console.log(`Assertions : ${total - echecs}/${total} OK${echecs ? ` | ${echecs} ECHEC(S)` : ''}`)
  console.log(`Brouillons temoins (compte test) conserves pour inspection.`)
  console.log('##################  FIN PHASE H  ##################\n')
  if (echecs) process.exit(1)
}

main().catch((e) => {
  console.error('\n❌ ERREUR :', e)
  process.exit(1)
})
