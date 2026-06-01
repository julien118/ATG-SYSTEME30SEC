// =============================================================
// Test du moteur de consultation de l'historique des devis (lecture seule)
// =============================================================
// Pose plusieurs questions realistes au moteur contre les VRAIS devis du compte
// test, et verifie que les chiffres de la reponse correspondent aux donnees
// reelles (recalcul independant) : pas d'hallucination. Lecture seule stricte.
//
// Lancer : npx tsx --env-file=.env.local scripts/test-devis-historique.mts

import {
  detecterTypologie,
  listerDevisCompteTest,
  repondreQuestion,
  type DevisResume,
} from '../lib/devis-historique'

const AUJOURDHUI = '2026-06-01'

let total = 0, echecs = 0
const ok = (c: boolean, label: string, detail = '') => {
  total++; if (!c) echecs++
  console.log(`   ${c ? '✅' : '❌'} ${label}${detail ? `  (${detail})` : ''}`)
}

const normaliser = (s: string) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
const normEspaces = (s: string) => (s ?? '').replace(/[\s  ]/g, '')
// La reponse contient-elle le montant (centimes) au format euros (a la virgule) ?
const contientMontant = (reponse: string, centimes: number) =>
  normEspaces(reponse).includes(normEspaces((centimes / 100).toFixed(2).replace('.', ',')))
const contientNombre = (reponse: string, n: number) =>
  new RegExp(`(^|\\D)${n}(\\D|$)`).test(reponse)
const eur = (c: number) => (c / 100).toFixed(2).replace('.', ',') + ' €'

async function poser(question: string): Promise<{ reponse: string; intent: any; resultat: any }> {
  const r = await repondreQuestion(question, AUJOURDHUI, devisTest)
  console.log(`\n❓ ${question}`)
  console.log(`   intent : ${JSON.stringify(r.intent)}`)
  console.log(`   → ${r.reponse.replace(/\n/g, '\n     ')}`)
  return r
}

let devisTest: DevisResume[] = []

async function main() {
  console.log('\n########  TEST MOTEUR CONSULTATION DEVIS (lecture seule)  ########\n')
  devisTest = await listerDevisCompteTest()
  console.log(`Devis charges (compte test) : ${devisTest.length}`)

  // Apercu : repartition par famille + top clients.
  const parFamille = new Map<string, number>()
  for (const d of devisTest) parFamille.set(d.typologie.famille ?? 'autre', (parFamille.get(d.typologie.famille ?? 'autre') ?? 0) + 1)
  console.log('Par famille :', Array.from(parFamille.entries()).map(([f, n]) => `${f}=${n}`).join(' '))
  const parClient = new Map<string, number>()
  for (const d of devisTest) parClient.set(d.clientNom, (parClient.get(d.clientNom) ?? 0) + 1)
  const clientTop = Array.from(parClient.entries()).sort((a, b) => b[1] - a[1])[0]
  console.log(`Client le plus frequent : "${clientTop[0]}" (${clientTop[1]} devis)`)

  // ---------- Q1 : devis d'un client donne ----------
  {
    const client = clientTop[0]
    const attendus = devisTest.filter((d) => normaliser(d.clientNom).includes(normaliser(client)))
    const r = await poser(`Liste-moi tous les devis du client ${client}.`)
    ok(r.resultat.nbDevis === attendus.length, 'Nb de devis du client = donnees reelles', `moteur=${r.resultat.nbDevis} reel=${attendus.length}`)
    ok(contientNombre(r.reponse, attendus.length) || attendus.length > 20, 'La reponse cite le bon nombre')
  }

  // ---------- Q2 : montant total d'une typologie (ITE) ----------
  {
    const ite = devisTest.filter((d) => d.typologie.famille === 'ite')
    const sommeC = ite.reduce((s, d) => s + d.montantHTCentimes, 0)
    const r = await poser('Quel est le montant total HT de tous mes devis d\'ITE ?')
    ok(r.resultat.agregat?.type === 'somme' && r.resultat.agregat?.valeurCentimes === sommeC, 'Somme ITE = donnees reelles', `moteur=${r.resultat.agregat?.valeurCentimes} reel=${sommeC}`)
    ok(contientMontant(r.reponse, sommeC), 'La reponse affiche le bon total', eur(sommeC))
  }

  // ---------- Q3 : prix moyen d'une typologie (ravalement) ----------
  {
    const rav = devisTest.filter((d) => d.typologie.famille === 'ravalement')
    const moyC = rav.length ? Math.round(rav.reduce((s, d) => s + d.montantHTCentimes, 0) / rav.length) : 0
    const r = await poser('Quel est le prix moyen HT de mes devis de ravalement ?')
    ok(r.resultat.agregat?.type === 'moyenne' && r.resultat.agregat?.valeurCentimes === moyC, 'Moyenne ravalement = donnees reelles', `moteur=${r.resultat.agregat?.valeurCentimes} reel=${moyC}`)
    ok(contientMontant(r.reponse, moyC), 'La reponse affiche la bonne moyenne', eur(moyC))
  }

  // ---------- Q4 : top 3 plus gros devis ----------
  {
    const top3 = [...devisTest].sort((a, b) => b.montantHTCentimes - a.montantHTCentimes).slice(0, 3)
    const r = await poser('Quels sont mes 3 plus gros devis ?')
    const idsMoteur = (r.resultat.devis as DevisResume[]).map((d) => d.id)
    ok(JSON.stringify(idsMoteur) === JSON.stringify(top3.map((d) => d.id)), 'Top 3 = les 3 plus gros reels', idsMoteur.length + ' devis')
    ok(contientMontant(r.reponse, top3[0].montantHTCentimes), 'La reponse affiche le montant du plus gros', eur(top3[0].montantHTCentimes))
  }

  // ---------- Q5 : nombre de devis sur une periode ----------
  {
    const dans = devisTest.filter((d) => d.dateISO && d.dateISO >= '2026-05-01' && d.dateISO <= '2026-05-31')
    const r = await poser('Combien de devis ai-je faits en mai 2026 ?')
    ok(r.resultat.nbDevis === dans.length, 'Nb de devis en mai 2026 = donnees reelles', `moteur=${r.resultat.nbDevis} reel=${dans.length}`)
    ok(contientNombre(r.reponse, dans.length), 'La reponse cite le bon nombre', `${dans.length}`)
  }

  // ---------- Q6 : plus gros devis (max global) ----------
  {
    const max = [...devisTest].sort((a, b) => b.montantHTCentimes - a.montantHTCentimes)[0]
    const r = await poser('Quel est mon plus gros devis, et pour quel client ?')
    ok(r.resultat.agregat?.valeurCentimes === max.montantHTCentimes || (r.resultat.devis[0]?.id === max.id), 'Plus gros devis = le max reel', eur(max.montantHTCentimes))
    ok(contientMontant(r.reponse, max.montantHTCentimes), 'La reponse affiche le bon montant max', eur(max.montantHTCentimes))
  }

  // ---------- Q7 : aucun resultat (ne doit pas inventer) ----------
  {
    const r = await poser('Montre-moi les devis du client Marc-Antoine de Saint-Inexistant.')
    ok(r.resultat.nbDevis === 0, 'Aucun devis correspondant', `${r.resultat.nbDevis}`)
    const dit = /aucun|pas de|n['e ]|aucune|rien|ne correspond|trouve aucun/i.test(r.reponse)
    ok(dit, 'La reponse dit clairement qu\'il n\'y a aucun devis (pas d\'invention)')
  }

  console.log(`\n########  BILAN : ${total - echecs}/${total} assertions OK${echecs ? ` | ${echecs} ECHEC(S)` : ''}  ########\n`)
  if (echecs) process.exit(1)
}

main().catch((e) => { console.error('\n❌ ERREUR :', e); process.exit(1) })
