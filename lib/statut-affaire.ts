// =============================================================
// Statut affiche d'une affaire (groupe B, point 2) — SOURCE DE VERITE UNIQUE
// =============================================================
// On NE modifie PAS l'ENUM `chantier_statut` en base. Le statut affiche (parmi 5)
// est DERIVE a la volee, en combinant trois signaux qui existent deja :
//   - `chantierStatut` : l'ENUM existant (planifie | en_cours | termine | rapport_genere) ;
//   - `aCompteRendu`   : une ligne `rapports` existe-t-elle ? (= le CR a ete genere) ;
//   - `devisStatut`    : le statut du devis lie, ou null (brouillon | sections_proposees |
//                        metres_en_cours | pousse_costructor | echec).
//
// Cette fonction est PURE (aucun acces base, aucun effet de bord) : c'est l'unique
// endroit ou la regle vit, pour eviter toute divergence. Tout l'affichage (badges,
// sections d'accueil) doit l'utiliser.
//
// Note legacy : `chantier.statut === 'rapport_genere'` etait pose (a tort) a
// l'arrivee sur l'ecran recap. La derivation s'appuie sur des signaux fiables
// (CR existe, devis existe) et retombe correctement pour ces anciennes lignes.

import type { ChantierStatut, DevisStatut } from './types'

// Les 5 statuts AFFICHES (distincts de l'ENUM base `chantier_statut`).
export type StatutAffiche =
  | 'planifie'
  | 'en_cours'
  | 'rapport_genere'
  | 'devis_en_cours'
  | 'devis_envoye'

// Les 2 grandes sections d'accueil (point 1).
export type SectionAffaire = 'visite_technique' | 'devis'

export interface EntreeStatut {
  chantierStatut: ChantierStatut
  aCompteRendu: boolean
  devisStatut: DevisStatut | null | undefined
}

// Derive le statut affiche selon la cascade (du plus avance au moins avance) :
//   1. devis envoye a Costructor          -> 'devis_envoye'
//   2. un devis existe (en cours/echec...) -> 'devis_en_cours'
//   3. le compte rendu a ete genere        -> 'rapport_genere'
//   4. la visite a demarre (en_cours/termine, ou legacy rapport_genere)
//                                           -> 'en_cours'
//   5. sinon (juste planifie)              -> 'planifie'
// Le devis est prioritaire sur le CR car un devis implique toujours un CR genere
// en amont : on affiche l'etape la plus avancee atteinte.
export function deriverStatutAffiche(entree: EntreeStatut): StatutAffiche {
  const { chantierStatut, aCompteRendu, devisStatut } = entree
  if (devisStatut === 'pousse_costructor') return 'devis_envoye'
  if (devisStatut) return 'devis_en_cours'
  if (aCompteRendu) return 'rapport_genere'
  if (chantierStatut !== 'planifie') return 'en_cours'
  return 'planifie'
}

// A quelle section d'accueil appartient un statut affiche :
//   - Visite technique : Planifie, En cours, Rapport genere (les 3 premiers) ;
//   - Devis            : Devis en cours, Devis envoye (les 2 derniers).
export function sectionDe(statut: StatutAffiche): SectionAffaire {
  return statut === 'devis_en_cours' || statut === 'devis_envoye'
    ? 'devis'
    : 'visite_technique'
}
