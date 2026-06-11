// =============================================================
// Garde-fous de compte Costructor (RÈGLE 1) — module partagé
// =============================================================
// Toute écriture Costructor (contact comme devis) DOIT passer par
// `assertCompteJulien()`. Avant la bascule prod (cible 'test', défaut), le compte
// d'Olivier (COSTRUCTOR_API_KEY_OLIVIER) ne doit JAMAIS être écrit : il n'est
// consulté qu'en lecture seule. Après bascule délibérée (ATG_COSTRUCTOR_CIBLE=
// 'olivier'), lecture ET écriture visent le MÊME compte (celui d'Olivier).
//
// Module volontairement sans dépendance runtime (il ne lit que process.env) pour
// être importable par lib/costructor.ts ET lib/atg-devis-modele.ts sans cycle.
// L'import de CompteCostructor est un import de TYPE seul (effacé à la
// compilation, donc aucun cycle runtime).

import type { CompteCostructor } from './types'

// RÉGLAGE UNIQUE de la cible Costructor (ATG_COSTRUCTOR_CIBLE). 'test' (défaut) =
// compte test Julien ; 'olivier' = compte d'Olivier. Source unique de vérité,
// partagée par la LECTURE des modèles (atg-devis-modele.ts) et par les gardes
// d'ÉCRITURE ci-dessous. Définie dans ce module neutre pour éviter un cycle
// d'import avec atg-devis-modele.ts (qui la ré-exporte pour les imports
// historiques).
export function compteCibleCostructor(): CompteCostructor {
  return process.env.ATG_COSTRUCTOR_CIBLE === 'olivier' ? 'olivier' : 'test'
}

// Renvoie la clé d'écriture APRÈS avoir vérifié la cohérence clé / cible. Toute
// fonction qui écrit DOIT passer par là.
//   - Cible 'test' (défaut) : la clé d'écriture ne doit PAS être celle d'Olivier
//     (protection pré-bascule / dev — comportement historique strictement
//     inchangé : on jette si les deux clés sont identiques).
//   - Cible 'olivier' (après bascule délibérée) : écrire avec la clé d'Olivier est
//     au contraire la configuration NORMALE (lecture + écriture sur son compte) ;
//     l'égalité des deux clés n'est donc plus une erreur.
// Le nom reste `assertCompteJulien` (historique, importé par de nombreux modules
// et scripts) : il faut désormais le lire comme « assert clé d'écriture cohérente
// avec la cible ».
export function assertCompteJulien(): string {
  const key = process.env.COSTRUCTOR_API_KEY
  const keyOlivier = process.env.COSTRUCTOR_API_KEY_OLIVIER
  if (!key) throw new Error('COSTRUCTOR_API_KEY (clé d\'écriture) manquante.')
  if (compteCibleCostructor() !== 'olivier' && keyOlivier && key === keyOlivier) {
    throw new Error(
      'STOP (RÈGLE 1) : la clé d\'écriture est celle d\'OLIVIER alors que la cible ' +
        'n\'est pas « olivier ». Aucune écriture autorisée sur son compte tant que la ' +
        'bascule (ATG_COSTRUCTOR_CIBLE=olivier) n\'a pas été faite.',
    )
  }
  return key
}

export function bannerCompte(action: 'LECTURE' | 'ÉCRITURE'): void {
  const key = process.env.COSTRUCTOR_API_KEY
  const libelle =
    compteCibleCostructor() === 'olivier' ? 'OLIVIER (production)' : 'JULIEN (test)'
  console.log('=============================================================')
  console.log(`COSTRUCTOR — ${action} sur le compte ${libelle}`)
  console.log(`  clé ...${key ? key.slice(-6) : '(absente)'}`)
  console.log('=============================================================')
}
