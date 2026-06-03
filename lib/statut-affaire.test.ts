// Tests unitaires de la derivation du statut affiche (groupe B, etape A).
// Pas de dependance externe : runner integre node:test.
// Lancer : npx tsx lib/statut-affaire.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriverStatutAffiche,
  sectionDe,
  type EntreeStatut,
  type StatutAffiche,
} from './statut-affaire'

interface Cas {
  libelle: string
  entree: EntreeStatut
  attendu: StatutAffiche
}

const CAS: Cas[] = [
  // --- Parcours nominal ---
  { libelle: 'Cree, visite pas commencee', entree: { chantierStatut: 'planifie', aCompteRendu: false, devisStatut: null }, attendu: 'planifie' },
  { libelle: 'Visite demarree (notes/photos)', entree: { chantierStatut: 'en_cours', aCompteRendu: false, devisStatut: null }, attendu: 'en_cours' },
  { libelle: 'Visite terminee, CR pas encore genere', entree: { chantierStatut: 'termine', aCompteRendu: false, devisStatut: null }, attendu: 'en_cours' },
  { libelle: 'CR genere (chantier termine)', entree: { chantierStatut: 'termine', aCompteRendu: true, devisStatut: null }, attendu: 'rapport_genere' },
  { libelle: 'CR genere (chantier encore en_cours)', entree: { chantierStatut: 'en_cours', aCompteRendu: true, devisStatut: null }, attendu: 'rapport_genere' },
  { libelle: 'Devis commence (sections proposees)', entree: { chantierStatut: 'termine', aCompteRendu: true, devisStatut: 'sections_proposees' }, attendu: 'devis_en_cours' },
  { libelle: 'Devis metres en cours', entree: { chantierStatut: 'termine', aCompteRendu: true, devisStatut: 'metres_en_cours' }, attendu: 'devis_en_cours' },
  { libelle: 'Devis brouillon', entree: { chantierStatut: 'termine', aCompteRendu: true, devisStatut: 'brouillon' }, attendu: 'devis_en_cours' },
  { libelle: 'Devis push echoue (retryable)', entree: { chantierStatut: 'termine', aCompteRendu: true, devisStatut: 'echec' }, attendu: 'devis_en_cours' },
  { libelle: 'Devis envoye a Costructor', entree: { chantierStatut: 'termine', aCompteRendu: true, devisStatut: 'pousse_costructor' }, attendu: 'devis_envoye' },

  // --- Lignes LEGACY : chantier.statut vaut deja 'rapport_genere' (ancien write recap) ---
  { libelle: 'LEGACY rapport_genere + CR + devis metres', entree: { chantierStatut: 'rapport_genere', aCompteRendu: true, devisStatut: 'metres_en_cours' }, attendu: 'devis_en_cours' },
  { libelle: 'LEGACY rapport_genere + CR + devis envoye', entree: { chantierStatut: 'rapport_genere', aCompteRendu: true, devisStatut: 'pousse_costructor' }, attendu: 'devis_envoye' },
  { libelle: 'LEGACY rapport_genere + CR, pas de devis', entree: { chantierStatut: 'rapport_genere', aCompteRendu: true, devisStatut: null }, attendu: 'rapport_genere' },
  { libelle: 'LEGACY rapport_genere defensif (ni CR ni devis)', entree: { chantierStatut: 'rapport_genere', aCompteRendu: false, devisStatut: null }, attendu: 'en_cours' },

  // --- Cas defensifs : le devis prime sur le reste ---
  { libelle: 'Devis present prime meme si chantier planifie', entree: { chantierStatut: 'planifie', aCompteRendu: false, devisStatut: 'sections_proposees' }, attendu: 'devis_en_cours' },
]

test('deriverStatutAffiche : table de cas', () => {
  console.log('\n  ENTREE (chantier / CR / devis)'.padEnd(60) + 'STATUT DERIVE')
  console.log('  ' + '-'.repeat(78))
  for (const c of CAS) {
    const got = deriverStatutAffiche(c.entree)
    const ok = got === c.attendu
    const entreeTxt = `${c.entree.chantierStatut} / CR=${c.entree.aCompteRendu} / devis=${c.entree.devisStatut ?? 'aucun'}`
    console.log(`  [${ok ? 'OK ' : 'KO!'}] ${entreeTxt.padEnd(46)} -> ${got}${ok ? '' : ` (ATTENDU ${c.attendu})`}`)
    assert.equal(got, c.attendu, `${c.libelle} : attendu ${c.attendu}, obtenu ${got}`)
  }
})

test('sectionDe : appartenance aux 2 sections', () => {
  const attendu: Record<StatutAffiche, string> = {
    planifie: 'visite_technique',
    en_cours: 'visite_technique',
    rapport_genere: 'visite_technique',
    devis_en_cours: 'devis',
    devis_envoye: 'devis',
  }
  console.log('')
  for (const statut of Object.keys(attendu) as StatutAffiche[]) {
    const got = sectionDe(statut)
    const ok = got === attendu[statut]
    console.log(`  [${ok ? 'OK ' : 'KO!'}] ${statut.padEnd(16)} -> ${got}`)
    assert.equal(got, attendu[statut])
  }
})
