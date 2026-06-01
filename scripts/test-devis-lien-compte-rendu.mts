// =============================================================
// Test E2E (Phase G, etape 2) : lien du compte rendu dans le devis Costructor
// =============================================================
// Verifie, sur le COMPTE TEST DE JULIEN uniquement (ecriture en brouillon), que :
//  CAS POSITIF (chantier avec PDF de compte rendu persiste) :
//    - la chaine routing -> clone modele -> push fonctionne (typologie I3 peinture),
//    - le devis pousse contient bien la ligne "Compte rendu de visite : <URL>",
//    - l'URL pointe sur le bon PDF (celui du chantier) et ouvre un vrai PDF,
//    - les totaux et la structure ne sont pas affectes par l'ajout du lien.
//  CAS NEGATIF (chantier dont le rapport n'a pas d'URL de PDF) :
//    - le devis pousse ne contient AUCUNE ligne de compte rendu, aucun lien casse.
//
// Contacts synthetiques (map du clone). Aucune ecriture Costructor hors compte
// test (assertCompteJulien). Aucune donnee client reelle.
//
// Lancer : npx tsx --env-file=.env.local scripts/test-devis-lien-compte-rendu.mts

import { readFileSync } from 'node:fs'
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
import { recupererUrlRapportPdf } from '../lib/rapport-pdf'

// Chantier AVEC PDF de compte rendu persiste (cas positif).
const CHANTIER_AVEC_PDF = 'f0ff75dc-b2f6-4034-95b3-d6c417c84456' // Residence Charles Daquin
// Chantier dont le rapport existe mais SANS pdf_url (cas negatif reel).
const CHANTIER_SANS_PDF = '0d02cca8-844a-4652-9735-9fc3f2f53be4' // Mr et Mme Martin

const LIBELLE_LIEN = 'Compte rendu de visite'

const strip = (s: string | null | undefined) =>
  (s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const ok = (c: boolean, label: string, detail = '') =>
  console.log(`${c ? '✅' : '❌'} ${label}${detail ? `  (${detail})` : ''}`)

// Compte les lignes d'un arbre de devis (structure) et somme les produits.
function statsArbre(lines: any[]): { groupes: number; produits: number; textes: number } {
  let groupes = 0, produits = 0, textes = 0
  const walk = (ls: any[]) => {
    for (const l of ls ?? []) {
      if (l.type === 'group') { groupes++; walk(l.lines) }
      else if (l.type === 'product') produits++
      else textes++
    }
  }
  walk(lines)
  return { groupes, produits, textes }
}

// Cherche le libelle du lien dans une description (devis pousse).
function descriptionContientLien(description: string | null | undefined): boolean {
  return strip(description).includes(LIBELLE_LIEN)
}

async function main() {
  console.log('\n############  TEST E2E — LIEN COMPTE RENDU DANS LE DEVIS  ############\n')

  // ---------- Préparation : routing + clone + métrés (typologie I3 peinture) ----------
  console.log('---------- Préparation du devis (clone-modèle I3 peinture) ----------')
  bannerCompte('LECTURE')
  const DICTEE = `Ravalement I3 peinture sur la maison rue des Tilleuls, deux façades.
Façade Sud : 60 mètres carrés, dessous de toit 12 mètres, appuis 8 mètres.
Façade Nord : 40 mètres carrés, dessous de toit 12 mètres.
Échafaudage sur l'ensemble, 100 mètres carrés. Lavage et traitement algicide.`

  const modelesRaw = await listerModeles()
  const modeles: ModeleDevis[] = modelesRaw.map((m: any) => ({
    id: m.id, name: m.name ?? null, description: m.description ?? null,
    total: m.total ?? null, model: !!m.model,
  }))
  const routage = selectionnerModele(DICTEE, modeles)
  console.log(`Routage : ${routage.typologie} (${routage.confiance}) → modèle ${routage.modeleId}`)
  if (!routage.modeleId) throw new Error('Pas de modèle sélectionné, arrêt.')

  const modele = await getModeleExpand(routage.modeleId)
  const produits = await listerProduitsPlats()
  const metres = await extraireMetres(DICTEE)
  const construit = construirePayloadDepuisModele(modele.lines, metres, produits)
  console.log(`Payload : ${construit.lines.length} lignes racine | total attendu ${(construit.totalAttenduCentimes / 100).toFixed(2)} € HT`)

  // Contact synthétique du compte test (map du clone, 100% fictif).
  const map = JSON.parse(readFileSync('data/clone-olivier-julien/map.json', 'utf8'))
  const customer = Object.values(map.contacts)[0] as string
  console.log('Contact synthétique :', customer)

  // URL attendue du PDF du chantier avec compte rendu.
  const urlAttendue = await recupererUrlRapportPdf(CHANTIER_AVEC_PDF)
  console.log('URL compte rendu attendue :', urlAttendue ?? '(aucune)')
  if (!urlAttendue) throw new Error('Le chantier témoin n\'a pas de pdf_url : lancer d\'abord l\'étape 1.')

  // ================= CAS POSITIF =================
  console.log('\n========== CAS POSITIF : chantier AVEC PDF ==========')
  assertCompteJulien()
  bannerCompte('ÉCRITURE')
  const descBasePos = 'TEST E2E lien CR (brouillon) - rue des Tilleuls'
  const creePos = await pousserDevisGroupe({
    customer,
    description: descBasePos,
    lines: construit.lines,
    chantierId: CHANTIER_AVEC_PDF,
  })
  console.log('Brouillon créé :', creePos.id)

  const reluPos = await getModeleExpand(creePos.id)
  const descPos = reluPos.description ?? ''
  console.log('\nDescription relue (HTML brut) :\n  ' + descPos)
  console.log('Description relue (texte affiché) :\n  "' + strip(descPos) + '"')

  ok(descriptionContientLien(descPos), 'Texte cliquable « Compte rendu de visite » présent')
  ok(descPos.includes(`href="${urlAttendue}"`), 'Ancre HTML <a href> vers le PDF exact du chantier (cliquable)', urlAttendue.slice(-40))
  ok(/(<br>|<\/p>|<p>)\s*<a [^>]*href=/.test(descPos), 'Lien sur son propre paragraphe, séparé du texte précédent')
  ok(strip(descPos).includes(strip(descBasePos)), 'La description de base est préservée')

  // Le lien ouvre bien le bon PDF.
  const res = await fetch(urlAttendue)
  const buf = Buffer.from(await res.arrayBuffer())
  const entete = buf.subarray(0, 4).toString('latin1')
  ok(res.ok && res.status === 200, `URL accessible (HTTP ${res.status})`)
  ok(entete === '%PDF', `Le lien ouvre un vrai PDF (entête "${entete}")`)
  ok(/^https?:\/\//.test(urlAttendue), 'URL bien formée (http/https, donc cliquable)')

  // Totaux et structure non affectés par l'ajout du lien.
  ok(reluPos.subtotal === construit.totalAttenduCentimes, 'Total devis == total attendu (lien sans impact)', `${reluPos.subtotal} vs ${construit.totalAttenduCentimes}`)
  const sPos = statsArbre(reluPos.lines)
  console.log(`Structure : ${sPos.groupes} groupes, ${sPos.produits} produits, ${sPos.textes} textes`)
  // Le lien ne doit PAS s'être glissé dans une ligne (uniquement description racine).
  const lienDansUneLigne = (function cherche(ls: any[]): boolean {
    for (const l of ls ?? []) {
      if (l.type !== 'group' && strip(l.description).includes(LIBELLE_LIEN)) return true
      if (l.type === 'group' && cherche(l.lines)) return true
    }
    return false
  })(reluPos.lines)
  ok(!lienDansUneLigne, 'Le lien est dans la description racine, pas dans une ligne (structure intacte)')

  // ================= CAS NÉGATIF =================
  console.log('\n========== CAS NÉGATIF : chantier SANS PDF ==========')
  const urlSansPdf = await recupererUrlRapportPdf(CHANTIER_SANS_PDF)
  console.log('URL compte rendu (attendue nulle) :', urlSansPdf ?? '(aucune)')
  ok(urlSansPdf === null, 'Le chantier témoin négatif n\'a pas de pdf_url')

  bannerCompte('ÉCRITURE')
  const descBaseNeg = 'TEST E2E sans CR (brouillon) - sans PDF'
  const creeNeg = await pousserDevisGroupe({
    customer,
    description: descBaseNeg,
    lines: construit.lines,
    chantierId: CHANTIER_SANS_PDF,
  })
  console.log('Brouillon créé :', creeNeg.id)

  const reluNeg = await getModeleExpand(creeNeg.id)
  const descNeg = reluNeg.description ?? ''
  console.log('Description relue (brut) :', '"' + strip(descNeg) + '"')
  ok(!descriptionContientLien(descNeg), 'AUCUNE ligne de compte rendu (pas de lien cassé)')
  ok(strip(descNeg) === strip(descBaseNeg), 'Description = description de base inchangée')

  // ---------- Récapitulatif ----------
  const urlCostructorPos = creePos.url ?? `https://app.costructor.co/quotes/${creePos.id}`
  console.log('\n############  RÉCAPITULATIF  ############')
  console.log('Brouillon témoin AVEC lien CR :', creePos.id)
  console.log('  URL Costructor (à revérifier visuellement) :', urlCostructorPos)
  console.log('  description HTML :\n    ' + descPos)
  console.log('Brouillon témoin SANS lien CR :', creeNeg.id)
  console.log('  description :\n    "' + strip(descNeg) + '"')
  console.log(`Total HT (inchangé par le lien) : ${(reluPos.subtotal / 100).toFixed(2)} €`)
  console.log('############  FIN  ############\n')
}

main().catch((e) => {
  console.error('\n❌ ERREUR :', e)
  process.exit(1)
})
