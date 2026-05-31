// =============================================================
// Garde-fous de compte Costructor (RÈGLE 1) — module partagé
// =============================================================
// Toute écriture Costructor (contact comme devis) DOIT passer par
// `assertCompteJulien()`. Le compte d'Olivier (COSTRUCTOR_API_KEY_OLIVIER) ne
// doit JAMAIS être écrit : il n'est consulté qu'en lecture seule.
//
// Module volontairement sans dépendance (il ne lit que process.env) pour être
// importable par lib/costructor.ts ET lib/atg-devis-modele.ts sans cycle.

// Renvoie la clé d'écriture (Julien) APRÈS avoir vérifié que ce n'est PAS celle
// d'Olivier. Toute fonction qui écrit DOIT passer par là.
export function assertCompteJulien(): string {
  const key = process.env.COSTRUCTOR_API_KEY
  const keyOlivier = process.env.COSTRUCTOR_API_KEY_OLIVIER
  if (!key) throw new Error('COSTRUCTOR_API_KEY (compte test Julien) manquante.')
  if (keyOlivier && key === keyOlivier) {
    throw new Error(
      'STOP (RÈGLE 1) : la clé d\'écriture est celle d\'OLIVIER. Aucune écriture autorisée sur son compte.',
    )
  }
  return key
}

export function bannerCompte(action: 'LECTURE' | 'ÉCRITURE'): void {
  const key = process.env.COSTRUCTOR_API_KEY
  console.log('=============================================================')
  console.log(`COSTRUCTOR — ${action} sur le compte JULIEN (test)`)
  console.log(`  clé ...${key ? key.slice(-6) : '(absente)'}`)
  console.log('=============================================================')
}
