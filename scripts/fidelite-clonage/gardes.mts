// A3 - Gardes de securite : PUR, aucun reseau. Verrouille les invariants NON
// negociables : (1) la source d'un snapshot doit correspondre a la cible courante
// (assertSnapshotCoherentAvecCible : cible 'test' par defaut ici, donc un snapshot
// Olivier est refuse) ; (2) assertCompteJulien refuse la cle d'Olivier (cible non
// 'olivier') et l'absence de cle (toute ecriture passe par la).

import { assertSnapshotCoherentAvecCible } from '../../lib/atg-devis-modele'
import { assertCompteJulien } from '../../lib/costructor-compte'
import { ko, ok, type Resultat } from './utils.mts'

function jette(fn: () => void): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

export async function testGardes(): Promise<Resultat[]> {
  const res: Resultat[] = []

  // (1) Garde de coherence snapshot -> ecriture (cible 'test' par defaut ici).
  res.push(
    jette(() => assertSnapshotCoherentAvecCible({ compte: 'olivier' }))
      ? ok('A3 coherence : snapshot Olivier REFUSE au push test')
      : ko('A3 coherence : snapshot Olivier REFUSE au push test', "n'a pas jete"),
  )
  res.push(
    !jette(() => assertSnapshotCoherentAvecCible({ compte: 'test' })) &&
      !jette(() => assertSnapshotCoherentAvecCible({}))
      ? ok('A3 coherence : snapshot test / absent ACCEPTE')
      : ko('A3 coherence : snapshot test / absent ACCEPTE', 'a jete a tort'),
  )

  // (2) Garde-fou d'ecriture (assertCompteJulien). On manipule process.env en
  // sauvegardant/restaurant, pour ne pas perturber les tests B/C qui suivent.
  const savedKey = process.env.COSTRUCTOR_API_KEY
  const savedOlivier = process.env.COSTRUCTOR_API_KEY_OLIVIER
  try {
    // Cle d'ecriture = cle d'Olivier -> doit jeter.
    process.env.COSTRUCTOR_API_KEY = 'cle_olivier_xyz'
    process.env.COSTRUCTOR_API_KEY_OLIVIER = 'cle_olivier_xyz'
    res.push(
      jette(() => assertCompteJulien())
        ? ok('A3 garde-fou : ecriture REFUSEE si cle = Olivier')
        : ko('A3 garde-fou : ecriture REFUSEE si cle = Olivier', "n'a pas jete"),
    )
    // Cle d'ecriture absente -> doit jeter.
    delete process.env.COSTRUCTOR_API_KEY
    res.push(
      jette(() => assertCompteJulien())
        ? ok('A3 garde-fou : ecriture REFUSEE si cle absente')
        : ko('A3 garde-fou : ecriture REFUSEE si cle absente', "n'a pas jete"),
    )
    // Cles distinctes -> autorise (renvoie la cle test).
    process.env.COSTRUCTOR_API_KEY = 'cle_test_aaa'
    process.env.COSTRUCTOR_API_KEY_OLIVIER = 'cle_olivier_bbb'
    res.push(
      !jette(() => assertCompteJulien())
        ? ok('A3 garde-fou : ecriture AUTORISEE si cles distinctes')
        : ko('A3 garde-fou : ecriture AUTORISEE si cles distinctes', 'a jete a tort'),
    )
  } finally {
    // Restaure l'environnement reel pour les tests suivants.
    if (savedKey === undefined) delete process.env.COSTRUCTOR_API_KEY
    else process.env.COSTRUCTOR_API_KEY = savedKey
    if (savedOlivier === undefined) delete process.env.COSTRUCTOR_API_KEY_OLIVIER
    else process.env.COSTRUCTOR_API_KEY_OLIVIER = savedOlivier
  }

  return res
}
