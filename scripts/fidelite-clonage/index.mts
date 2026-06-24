// Suite de fidelite du moteur de clonage ITE - orchestrateur lancable d'une
// commande : npm run test:fidelite  (ou npx tsx --env-file=.env.local scripts/fidelite-clonage/index.mts)
//
// Niveaux :
//   A (purs, hors-ligne)         : A1 routing, A2 reconstruction, A3 gardes.
//   B (lecture seule GET only)   : B1 fidelite replique <-> vrai modele Olivier.
//   C (e2e compte test + cleanup): C1 cycle complet, C2 forfaits fixes.
//
// SECURITE : lectures GET only (test via getJulien, Olivier via
// getDevisOlivierLectureSeule) ; ecritures = brouillons sur le compte test
// uniquement via assertCompteJulien ; chaque brouillon est supprime (try/finally).
// JAMAIS d'ecriture chez Olivier. Pre-check : refuse de tourner si la cle test ==
// la cle Olivier.

import { testRouting } from './routing.mts'
import { testReconstruction, testReordonnancement } from './reconstruction.mts'
import { testGardes } from './gardes.mts'
import { testFideliteModele } from './fidelite-modele.mts'
import { testE2eReinjection } from './e2e-reinjection.mts'
import { testE2eOrdre } from './e2e-ordre.mts'
import { testForfaitsFixes } from './forfaits-fixes.mts'
import { ko, type Resultat } from './utils.mts'

function precheckSecurite(): boolean {
  const key = process.env.COSTRUCTOR_API_KEY
  const olivier = process.env.COSTRUCTOR_API_KEY_OLIVIER
  console.log('=============================================================')
  console.log('SUITE DE FIDELITE - moteur de clonage ITE')
  console.log(`  cle test    : ...${key ? key.slice(-6) : '(absente)'}`)
  console.log(`  cle Olivier : ...${olivier ? olivier.slice(-6) : '(absente)'} (lecture seule GET)`)
  console.log('=============================================================\n')
  if (key && olivier && key === olivier) {
    console.error('❌ STOP : COSTRUCTOR_API_KEY === COSTRUCTOR_API_KEY_OLIVIER. Refus de tourner (risque d ecriture chez Olivier).')
    return false
  }
  return true
}

const FAMILLES: Array<{ nom: string; run: () => Promise<Resultat[]> }> = [
  { nom: 'A1 routing (pur)', run: testRouting },
  { nom: 'A2 reconstruction (hors-ligne)', run: testReconstruction },
  { nom: 'A4 reordonnancement (hors-ligne)', run: testReordonnancement },
  { nom: 'A3 gardes de securite (pur)', run: testGardes },
  { nom: 'B1 fidelite modele (GET only)', run: testFideliteModele },
  { nom: 'C1 e2e reinjection (compte test)', run: testE2eReinjection },
  { nom: 'C3 e2e ordre des sections (compte test)', run: testE2eOrdre },
  { nom: 'C2 forfaits fixes (compte test)', run: testForfaitsFixes },
]

async function main() {
  if (!precheckSecurite()) process.exit(2)

  const tous: Resultat[] = []
  for (const f of FAMILLES) {
    console.log(`\n--- ${f.nom} ---`)
    let res: Resultat[]
    try {
      res = await f.run()
    } catch (e) {
      res = [ko(f.nom, `exception : ${(e as Error).message}`)]
    }
    for (const r of res) {
      const icone = r.statut === 'PASS' ? '✅' : r.statut === 'SKIP' ? '⏭️ ' : '❌'
      console.log(`  ${icone} ${r.statut.padEnd(4)} ${r.nom}${r.details ? ' — ' + r.details : ''}`)
    }
    tous.push(...res)
  }

  const pass = tous.filter((r) => r.statut === 'PASS').length
  const fail = tous.filter((r) => r.statut === 'FAIL').length
  const skipN = tous.filter((r) => r.statut === 'SKIP').length
  console.log('\n=============================================================')
  console.log(`RECAP : ${pass} PASS | ${fail} FAIL | ${skipN} SKIP  (sur ${tous.length} verifications)`)
  console.log('=============================================================')
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('\n❌ ERREUR ORCHESTRATEUR :', e)
  process.exit(1)
})
