// =============================================================
// Test bout en bout — les 4 typologies restantes + robustesse routing
// =============================================================
// I3 taloché, I4 taloché, ITE standard, ITE détaillée.
// Écriture sur le COMPTE TEST DE JULIEN uniquement, brouillons. Le compte
// d'Olivier n'est pas touché ici.
//
// Lancer : npx tsx --env-file=.env.local scripts/test-devis-toutes-typologies.mts

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
  type LignePayload,
} from '../lib/atg-devis-modele'

const strip = (s: string | null | undefined) =>
  (s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

// ---------- Dictées réalistes par typologie ----------
const DICTEES: Record<string, { attendu: string; texte: string }> = {
  'I3 taloché': {
    attendu: 'ravalement_i3_taloche',
    texte: `Ravalement I3 finition talochée sur le pavillon rue du Clos, deux façades et deux pignons.
Façade avant 48 mètres carrés, dessous de toit 16 mètres linéaires, contours de fenêtres métal à reprendre 6 mètres carrés.
Façade arrière 48 mètres carrés, dessous de toit 16 mètres.
Pignon gauche 30 mètres carrés. Pignon droit 30 mètres carrés.
Échafaudage 200 mètres carrés, lavage et traitement algicide sur l'ensemble. Benne pour les déchets.`,
  },
  'I4 taloché': {
    attendu: 'ravalement_i4_taloche',
    texte: `Ravalement I4 finition talochée, façade très dégradée rue des Vignes, trois façades.
Façade Sud 55 mètres carrés, appuis de fenêtres 10 mètres, dessous de toit 15 mètres.
Façade Nord 52 mètres carrés, appuis 8 mètres, dessous de toit 15 mètres.
Pignon Est 26 mètres carrés.
Échafaudage 180 mètres carrés, lavage et traitement sur tout.`,
  },
  'ITE standard': {
    attendu: 'ite_standard',
    texte: `ITE, isolation par l'extérieur système StarSystem sur la maison rue des Acacias, quatre façades.
Façade Nord 60 mètres carrés d'isolant, appuis 12 mètres, dessous de toit 14 mètres, tableaux de fenêtres isolés 18 mètres, soubassement 9 mètres carrés.
Façade Sud 60 mètres carrés, appuis 12 mètres, dessous de toit 14 mètres, tableaux 18 mètres, soubassement 9 mètres carrés.
Façade Est 35 mètres carrés, tableaux 10 mètres, soubassement 5 mètres carrés.
Façade Ouest 35 mètres carrés, tableaux 10 mètres, soubassement 5 mètres carrés.
Échafaudage 230 mètres carrés, lavage et traitement sur tout.`,
  },
  'ITE détaillée': {
    attendu: 'ite_detaille',
    texte: `ITE complète garantie décennale rue de la Forêt, isolation extérieure PSE 140 R 4.50, avec partie chauffée et partie non chauffée, quatre façades.
Façade principale 70 mètres carrés d'isolant, couvertine 12 mètres, dessous de toit 16 mètres, appuis 14 mètres, 3 jeux de volets battants, un report d'éclairage et un report de robinet, une descente d'eau pluviale à modifier.
Façade arrière 70 mètres carrés, couvertine 12 mètres, dessous de toit 16 mètres, appuis 14 mètres, 3 jeux de volets, un report d'éclairage et un de robinet, une descente d'eau pluviale.
Pignon gauche 40 mètres carrés, couvertine 8 mètres, dessous de toit 10 mètres, 2 jeux de volets.
Pignon droit 40 mètres carrés, couvertine 8 mètres, dessous de toit 10 mètres, 2 jeux de volets.
Échafaudage 250 mètres carrés, benne pour les déchets.`,
  },
}

// Dictées de robustesse (frontière ravalement / ITE + cas limites).
const ROBUSTESSE: Array<{ texte: string; attenduFamille: string; note: string }> = [
  { texte: 'Ravalement I3 peinture, deux façades, fissures à reprendre.', attenduFamille: 'ravalement', note: 'ravalement pur' },
  { texte: 'On part sur de l\'ITE, isolant polystyrène 140mm R=4.50 sur toute la maison.', attenduFamille: 'ite', note: 'ITE pur (isolant/R)' },
  { texte: 'Isolation thermique par l\'extérieur avec finition peinture talochée.', attenduFamille: 'ite', note: 'PIÈGE : "peinture talochée" présent mais ITE doit gagner' },
  { texte: 'Ravalement peinture sur façade, surtout pas d\'isolation, le client ne veut pas d\'ITE.', attenduFamille: 'ravalement', note: 'PIÈGE : mot "ITE/isolation" cité en négation' },
  { texte: 'Réfection de la toiture et des gouttières.', attenduFamille: 'inconnue', note: 'hors périmètre → aucune' },
]

interface ResultatTypo {
  nom: string
  attendu: string
  routageOk: boolean
  typologie: string
  famille: string
  confiance: string
  modeleId: string | null
  modeleDesc: string | null
  nbFacades: number
  groupes: string[]
  totalCentimes: number
  totalRelu: number
  totauxOk: boolean
  structureOk: boolean
  devisId: string
  nonResolus: string[]
}

function statsArbre(lines: any[]) {
  const groupes: string[] = []
  let produits = 0
  let sommeTous = 0
  const walk = (ls: any[]) => {
    for (const l of [...(ls ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
      if (l.type === 'group') { groupes.push(strip(l.description) || '∅'); walk(l.lines) }
      else if (l.type === 'product') { produits++; sommeTous += l.subtotal ?? 0 }
    }
  }
  walk(lines)
  return { groupes, produits, sommeTous }
}

async function runTypologie(
  nom: string,
  attendu: string,
  texte: string,
  modeles: ModeleDevis[],
  produits: any[],
  customer: string,
): Promise<ResultatTypo> {
  console.log(`\n================  ${nom}  ================`)
  const routage = selectionnerModele(texte, modeles)
  console.log(`routing : famille=${routage.famille} typologie=${routage.typologie} confiance=${routage.confiance}`)
  console.log(`          modèle=${routage.modeleId} "${routage.modeleDescription}"`)
  console.log(`          ${routage.raison}`)

  if (!routage.modeleId) throw new Error(`Pas de modèle pour ${nom}`)
  const modele = await getModeleExpand(routage.modeleId)
  const metres = await extraireMetres(texte)
  console.log(`métrés  : ${metres.facades.length} façades → ${metres.facades.map((f) => `${f.nom}(${f.surface_m2}m²)`).join(', ')}`)
  const construit = construirePayloadDepuisModele(modele.lines, metres, produits)

  assertCompteJulien()
  bannerCompte('ÉCRITURE')
  const cree = await pousserDevisGroupe({
    customer,
    description: `TEST E2E ${nom} (brouillon)`,
    lines: construit.lines,
  })
  const relu = await getModeleExpand(cree.id)
  const s = statsArbre(relu.lines)

  const totauxOk =
    relu.subtotal === construit.totalAttenduCentimes && s.sommeTous === relu.subtotal
  const facadesPresentes = metres.facades.every((f) =>
    s.groupes.some((g) => g.toLowerCase().includes(f.nom.toLowerCase())),
  )
  console.log(`devis   : ${cree.id} | total=${(relu.subtotal / 100).toFixed(2)}€ | groupes=[${s.groupes.join(' | ')}]`)
  console.log(`vérif   : totaux ${totauxOk ? 'OK' : 'KO'} | façades présentes ${facadesPresentes ? 'OK' : 'KO'}`)
  if (construit.nonResolus.length)
    console.log(`          points non résolus : ${construit.nonResolus.map((p) => p.libelle).join(' | ')}`)

  return {
    nom,
    attendu,
    routageOk: routage.typologie === attendu,
    typologie: routage.typologie,
    famille: routage.famille,
    confiance: routage.confiance,
    modeleId: routage.modeleId,
    modeleDesc: routage.modeleDescription,
    nbFacades: metres.facades.length,
    groupes: s.groupes,
    totalCentimes: construit.totalAttenduCentimes,
    totalRelu: relu.subtotal,
    totauxOk,
    structureOk: facadesPresentes,
    devisId: cree.id,
    nonResolus: construit.nonResolus.map((p) => p.libelle),
  }
}

async function main() {
  console.log('\n############  EXTENSION 4 TYPOLOGIES + ROBUSTESSE  ############')
  bannerCompte('LECTURE')
  const modelesRaw = await listerModeles()
  const modeles: ModeleDevis[] = modelesRaw.map((m: any) => ({
    id: m.id, name: m.name ?? null, description: m.description ?? null, total: m.total ?? null, model: !!m.model,
  }))
  const produits = await listerProduitsPlats()
  const map = JSON.parse(readFileSync('data/clone-olivier-julien/map.json', 'utf8'))
  const customer = Object.values(map.contacts)[0] as string

  // ---------- Étape 2 : les 4 typologies ----------
  const resultats: ResultatTypo[] = []
  for (const [nom, { attendu, texte }] of Object.entries(DICTEES)) {
    resultats.push(await runTypologie(nom, attendu, texte, modeles, produits, customer))
  }

  // ---------- Étape 3 : robustesse routing ----------
  console.log('\n\n############  ROBUSTESSE ROUTING (frontière ravalement / ITE)  ############\n')
  const robResults: Array<{ ok: boolean; ligne: string }> = []
  for (const c of ROBUSTESSE) {
    const r = selectionnerModele(c.texte, modeles)
    const ok = r.famille === c.attenduFamille
    robResults.push({ ok, ligne: `${ok ? '✅' : '❌'} [${c.attenduFamille}→${r.famille}] ${c.note} :: "${c.texte.slice(0, 60)}"` })
    console.log(robResults[robResults.length - 1].ligne)
  }

  // ---------- Étape 4 : rapport consolidé ----------
  console.log('\n\n############  RAPPORT CONSOLIDÉ  ############\n')
  console.log('TYPOLOGIE          | route | conf.  | modèle desc            | façades | total HT     | totaux | struct')
  console.log('-------------------|-------|--------|------------------------|---------|--------------|--------|-------')
  for (const r of resultats) {
    console.log(
      `${r.nom.padEnd(18)} | ${(r.routageOk ? 'OK' : 'KO').padEnd(5)} | ${r.confiance.padEnd(6)} | ${(r.modeleDesc ?? '').slice(0, 22).padEnd(22)} | ${String(r.nbFacades).padEnd(7)} | ${((r.totalRelu / 100).toFixed(2) + '€').padEnd(12)} | ${(r.totauxOk ? 'OK' : 'KO').padEnd(6)} | ${r.structureOk ? 'OK' : 'KO'}`,
    )
  }
  console.log('\nBrouillons témoins (compte test) :')
  for (const r of resultats) console.log(`  - ${r.nom.padEnd(18)} : ${r.devisId}`)

  const robOk = robResults.filter((r) => r.ok).length
  console.log(`\nRobustesse routing : ${robOk}/${robResults.length} OK`)

  const tout = resultats.every((r) => r.routageOk && r.totauxOk && r.structureOk) && robOk === robResults.length
  console.log(`\n${tout ? '✅ TOUT VERT' : '❌ des cas à revoir'}`)
  console.log('\n############  FIN  ############\n')
}

main().catch((e) => {
  console.error('\n❌ ERREUR :', e)
  process.exit(1)
})
