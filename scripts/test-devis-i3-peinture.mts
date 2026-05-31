// =============================================================
// Test bout en bout — Phase D + E sur la typologie « ravalement I3 peinture »
// =============================================================
// Pipeline complet sur le COMPTE TEST DE JULIEN uniquement (écriture), avec un
// contrôle final en LECTURE SEULE sur le compte d'Olivier (aucune donnée client
// sauvegardée). Devis créé en BROUILLON.
//
// Lancer : npx tsx --env-file=.env.local scripts/test-devis-i3-peinture.mts

import { readFileSync } from 'node:fs'
import { selectionnerModele, type ModeleDevis } from '../lib/atg-routing'
import {
  assertCompteJulien,
  bannerCompte,
  construirePayloadDepuisModele,
  extraireMetres,
  getDevisOlivierLectureSeule,
  getModeleExpand,
  listerModeles,
  listerProduitsPlats,
  pousserDevisGroupe,
  roleProduit,
  sommeProduits,
  type LignePayload,
} from '../lib/atg-devis-modele'

const strip = (s: string | null | undefined) =>
  (s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

// ---------- Dictée d'exemple réaliste (façon terrain, ravalement I3 peinture) ----------
const DICTEE = `Ravalement I3 peinture sur la maison rue des Tilleuls, trois façades à traiter.
Façade Sud, plein soleil, ancien revêtement fariné : 62 mètres carrés, dessous de toit 14 mètres linéaires, appuis de fenêtres 9 mètres.
Façade Nord, mousses et humidité : 58 mètres carrés, dessous de toit 14 mètres, appuis 7 mètres.
Pignon Est, quelques fissures : 24 mètres carrés, pas de dessous de toit ni d'appuis de ce côté.
Accès par échafaudage sur l'ensemble, 180 mètres carrés. Lavage et traitement algicide sur toutes les façades.
Points particuliers : une souche de cheminée à reprendre en peinture décorative, au forfait. Et une descente d'eau pluviale à remettre en peinture, 8 mètres linéaires.`

// Vérification d'assertion simple.
function check(cond: boolean, label: string, detail?: string): boolean {
  console.log(`${cond ? '✅' : '❌'} ${label}${!cond && detail ? `  (${detail})` : ''}`)
  return cond
}

// Parcourt un arbre de lignes GET et collecte des stats de structure.
function statsArbre(lines: any[]): {
  groupes: string[]
  produits: number
  textes: number
  sommeProduitsRacine: number
  sommeTousProduits: number
} {
  const groupes: string[] = []
  let produits = 0
  let textes = 0
  let sommeTousProduits = 0
  const walk = (ls: any[]) => {
    for (const l of [...(ls ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
      if (l.type === 'group') {
        groupes.push(strip(l.description))
        walk(l.lines)
      } else if (l.type === 'product') {
        produits++
        sommeTousProduits += l.subtotal ?? 0
      } else textes++
    }
  }
  walk(lines)
  // somme des subtotaux de PREMIER niveau (groupes agrègent déjà leurs enfants)
  const sommeProduitsRacine = [...(lines ?? [])].reduce(
    (s, l) => s + (l.subtotal ?? 0),
    0,
  )
  return { groupes, produits, textes, sommeProduitsRacine, sommeTousProduits }
}

async function main() {
  console.log('\n################  TEST E2E — RAVALEMENT I3 PEINTURE  ################\n')

  // ---------- PHASE D : routing ----------
  console.log('---------- PHASE D : routing par typologie ----------')
  bannerCompte('LECTURE')
  const modelesRaw = await listerModeles()
  const modeles: ModeleDevis[] = modelesRaw.map((m: any) => ({
    id: m.id,
    name: m.name ?? null,
    description: m.description ?? null,
    total: m.total ?? null,
    model: !!m.model,
  }))
  const routage = selectionnerModele(DICTEE, modeles)
  console.log('\nRoutage :')
  console.log('  typologie  :', routage.typologie, `(${routage.libelle})`)
  console.log('  modèle     :', routage.modeleId, `→ "${routage.modeleDescription}"`)
  console.log('  confiance  :', routage.confiance)
  console.log('  raison     :', routage.raison)
  console.log('  alternatives:', routage.alternatives.map((a) => `${a.libelle}=${a.score}`).join(', ') || '(aucune)')
  console.log()
  check(routage.typologie === 'ravalement_i3_peinture', 'Typologie détectée = ravalement_i3_peinture')
  check(!!routage.modeleId, 'Un modèle a été sélectionné')
  check(routage.confiance === 'haute' || routage.confiance === 'moyenne', `Confiance suffisante (${routage.confiance})`)
  if (!routage.modeleId) throw new Error('Pas de modèle → arrêt.')

  // ---------- PHASE E : clonage + remplissage ----------
  console.log('\n---------- PHASE E : extraction métrés + clonage + remplissage ----------')
  const modele = await getModeleExpand(routage.modeleId)
  const produits = await listerProduitsPlats()
  console.log(`Modèle source : ${modele.lines?.length} lignes racine | catalogue plat : ${produits.length} produits`)

  console.log('\nExtraction des métrés (Claude)...')
  const metres = await extraireMetres(DICTEE)
  console.log('Façades :')
  for (const f of metres.facades)
    console.log(`  - ${f.nom} : surface=${f.surface_m2} m² | dessous toit=${f.dessous_toit_ml} ml | appuis=${f.appuis_ml} ml`)
  console.log('Transversal :', JSON.stringify(metres.transversal))
  console.log('Points singuliers :', metres.points_singuliers.map((p) => `${p.type}(${p.quantite}${p.unite})`).join(', ') || '(aucun)')

  const construit = construirePayloadDepuisModele(modele.lines, metres, produits)
  console.log(`\nPayload construit : ${construit.lines.length} lignes racine | total attendu : ${(construit.totalAttenduCentimes / 100).toFixed(2)} € HT`)
  if (construit.nonResolus.length)
    console.log('  ⚠️ points non résolus (non ajoutés en silence) :', construit.nonResolus.map((p) => p.libelle).join(' | '))

  // Contact synthétique du compte test (depuis la map de clone — 100% fictif).
  const map = JSON.parse(readFileSync('data/clone-olivier-julien/map.json', 'utf8'))
  const customer = Object.values(map.contacts)[0] as string
  console.log('  contact (synthétique compte test) :', customer)

  // ---------- PUSH BROUILLON (écriture compte Julien uniquement) ----------
  console.log('\n---------- PUSH BROUILLON ----------')
  assertCompteJulien()
  bannerCompte('ÉCRITURE')
  const cree = await pousserDevisGroupe({
    customer,
    description: 'TEST E2E I3 peinture (brouillon) - rue des Tilleuls',
    lines: construit.lines,
  })
  console.log('Devis créé :', cree.id, '| total renvoyé :', cree.total, 'centimes')

  // ---------- VÉRIFICATION (GET read-back) ----------
  console.log('\n---------- VÉRIFICATION (GET du devis créé) ----------')
  const relu = await getModeleExpand(cree.id)
  const s = statsArbre(relu.lines)
  console.log('Structure relue :')
  console.log('  groupes :', s.groupes.join(' | '))
  console.log(`  produits=${s.produits} textes=${s.textes}`)
  console.log(`  subtotal devis (racine, fait foi) = ${relu.subtotal} c = ${(relu.subtotal / 100).toFixed(2)} €`)
  console.log(`  somme subtotaux PREMIER niveau     = ${s.sommeProduitsRacine} c`)
  console.log(`  somme de TOUS les produits (chaque produit 1x) = ${s.sommeTousProduits} c`)
  console.log()

  // Façades attendues présentes comme titres de groupe.
  const titresGroupes = s.groupes.map((g) => g.toLowerCase())
  for (const f of metres.facades)
    check(titresGroupes.some((t) => t.includes(f.nom.toLowerCase())), `Groupe façade « ${f.nom} » présent`)
  check(titresGroupes.some((t) => t.includes('elevation') || t.includes('élévation') || t.includes('lavage')), 'Bloc transversal (Élévation/lavage/traitement) présent')
  check(titresGroupes.some((t) => t.includes('eco') || t.includes('éco')), 'Groupe Éco-contribution conservé')
  check(titresGroupes.some((t) => t.includes('singulier')), 'Groupe Points singuliers présent')

  // Totaux : niveau racine fait foi, et == somme de mes produits, == total attendu.
  check(relu.subtotal === construit.totalAttenduCentimes, 'Total devis == total attendu (calcul payload)', `${relu.subtotal} vs ${construit.totalAttenduCentimes}`)
  check(s.sommeTousProduits === relu.subtotal, 'Somme produits (chacun 1x) == subtotal racine', `${s.sommeTousProduits} vs ${relu.subtotal}`)

  // Format descriptions : héritées du modèle (style Olivier), non vides.
  const exempleRaval = (function trouver(ls: any[]): any {
    for (const l of [...(ls ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
      if (l.type === 'product' && roleProduit(l.description) === 'ravalement') return l
      if (l.type === 'group') { const r = trouver(l.lines); if (r) return r }
    }
    return null
  })(relu.lines)
  if (exempleRaval) {
    const d = strip(exempleRaval.description)
    console.log('\nExemple description ravalement (héritée du modèle) :\n  "' + d.slice(0, 160) + '..."')
    check(d.length > 20, 'Description produit non vide (style Olivier hérité du modèle)')
  }

  // ---------- RAPPORT DE FIDÉLITÉ ----------
  console.log('\n################  RAPPORT DE FIDÉLITÉ  ################\n')

  // a) vs modèle source (structure)
  const sModele = statsArbre(modele.lines)
  console.log('A) Structure vs modèle source :')
  console.log(`   modèle  : groupes=${sModele.groupes.length} (${sModele.groupes.map((g) => g || '∅').join(', ')})`)
  console.log(`   généré  : groupes=${s.groupes.length} (${s.groupes.join(', ')})`)
  console.log(`   → en-tête + motif façade + éco conservés ; façades = celles de la dictée (${metres.facades.length}), pas les 4 fixes du modèle.`)

  // b) vs STYLE-OLIVIER (longueur descriptions)
  const longueurs: number[] = []
  ;(function coll(ls: any[]) {
    for (const l of ls ?? []) {
      if (l.type === 'product') longueurs.push(strip(l.description).length)
      if (l.type === 'group') coll(l.lines)
    }
  })(relu.lines)
  longueurs.sort((a, b) => a - b)
  const mediane = longueurs.length ? longueurs[Math.floor(longueurs.length / 2)] : 0
  console.log('\nB) Style descriptions vs STYLE-OLIVIER.md :')
  console.log(`   longueur descriptions produit : médiane=${mediane}, min=${longueurs[0]}, max=${longueurs[longueurs.length - 1]}`)
  console.log('   (réf. Olivier : médiane ~106, max ~643 — descriptions héritées telles quelles du modèle répliqué)')

  // c) Contrôle final : un vrai devis I3 peinture d'Olivier (GET lecture seule, aucune PII sauvegardée)
  console.log('\nC) Contrôle vs un vrai devis I3 peinture d\'Olivier (GET lecture seule, aucune donnée sauvegardée) :')
  try {
    const liste = await getDevisOlivierLectureSeule('/quotes?_limit=1000&_sort=createdAt&_order=desc')
    const candidats = (liste as any[]).filter(
      (q) => !q.model && /i3.*peinture|peinture.*i3/i.test(`${q.description ?? ''} ${q.name ?? ''}`),
    )
    if (candidats.length === 0) {
      console.log('   (aucun devis I3 peinture identifiable par description sur le compte d\'Olivier — contrôle ignoré)')
    } else {
      const vrai = await getDevisOlivierLectureSeule(`/quotes/${candidats[0].id}?_expand=lines`)
      const sv = statsArbre(vrai.lines)
      // On n'affiche QUE des métriques de structure, jamais le contenu client.
      console.log(`   vrai devis Olivier (${candidats.length} trouvés) : ${sv.groupes.length} groupes, ${sv.produits} produits, ${sv.textes} lignes texte`)
      console.log(`   généré                                : ${s.groupes.length} groupes, ${s.produits} produits, ${s.textes} lignes texte`)
      console.log('   → comparaison de structure uniquement (familles de sections, profondeur de groupes).')
    }
  } catch (e) {
    console.log('   (contrôle Olivier ignoré :', (e as Error).message, ')')
  }

  console.log('\nDevis brouillon de test conservé sur le compte Julien :', cree.id)
  console.log('################  FIN  ################\n')
}

main().catch((e) => {
  console.error('\n❌ ERREUR :', e)
  process.exit(1)
})
