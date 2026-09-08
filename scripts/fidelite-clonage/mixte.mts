// A6 - CHANTIER MIXTE HORS-LIGNE (moteur mixte-aware) : PUR, aucun reseau.
// Reproduit le cas « Goyat » : un meme chantier melange des facades en ITE et
// des facades en ravalement. On derive un devis COMPOSITE (chaque facade clone le
// motif de SON modele), on saisit les metres + edits d'Olivier, on reconstruit
// l'arbre depuis un snapshot COMPOSITE, et on verifie de facon deterministe :
//   - anti-bug Goyat : une facade ravalement ne contient QUE des postes ravalement
//     (jamais d'ITE) et inversement — l'ITE ne « disparait » plus et ne contamine
//     pas les facades peinture.
//   - TVA MIXTE : postes ITE a 5,5 %, postes ravalement a 10 %, ligne par ligne.
//   - refs COMPOSITES `facade@<modelId>` : renommage / suppression / ajout par
//     facade honores.
//   - total au centime (verification independante) et retro-compat (un snapshot
//     SANS `modeles` = chemin mono-modele historique, inchange).

import {
  deriverSectionsDepuisModele,
  deriverSectionsMixte,
  reconstruireDepuisSnapshot,
  sommeProduits,
} from '../../lib/atg-devis-modele'
import type { ArticleDevis, SectionDevis } from '../../lib/types'
import {
  aplatir,
  ko,
  MODELE_FABRIQUE,
  MODELE_FABRIQUE_RAVALEMENT,
  norm,
  occ,
  ok,
  type Resultat,
} from './utils.mts'

// Ids de modele fabriques (base = ITE, additionnel = ravalement).
const ID_ITE = 'quote_ite'
const ID_RAV = 'quote_rav'

// Total attendu (calcule a la main), en centimes :
//   Installation : ech 1000 x 200                                  = 200000
//   Facade Nord (ITE)  : ITE 13000x70=910000 ; PSE 5000x70=350000 ;
//                        ITE#1 non chauffee vide -> 0 ; dst 2000x16 = 32000  => 1292000
//   Facade Sud  (ITE)  : ITE 13000x50=650000 ; PSE 5000x50=250000 ;
//                        ITE#1 vide -> 0 ; dst 2000x10           = 20000     =>  920000
//   Facade Est  (RAV)  : RAV 4000x40=160000 ; dst 2000x8=16000               =>  176000
//                        + article ajoute 100€ x3 = 10000c x3    = 30000
//   Facade Ouest(RAV)  : RAV 4000x30=120000 ; dst SUPPRIME -> 0              =>  120000
//   Dechets (forfait) 30000 ; Eco (forfait) 500
const ATTENDU_CENTIMES = 200000 + 1292000 + 920000 + 176000 + 30000 + 120000 + 30000 + 500 // 2768500

function setQ(s: SectionDevis | undefined, ref: string, q: number | null) {
  const a = s?.articles.find((x) => x.ref_modele === ref)
  if (a) a.quantite = q
}

// Product.id directement portes (recursivement) par le groupe de nom donne, dans
// l'arbre PAYLOAD reconstruit. Sert a prouver l'appartenance PAR FACADE.
function produitsDuGroupe(lignes: any[], nomGroupe: string): string[] {
  const cible = norm(nomGroupe)
  const ids: string[] = []
  const collect = (ls: any[]) => {
    for (const l of ls ?? []) {
      if (l.type === 'product') ids.push(typeof l.product === 'string' ? l.product : l.product?.id ?? '')
      else if (l.type === 'group') collect(l.lines)
    }
  }
  for (const l of lignes ?? []) {
    if (l.type === 'group' && norm(l.description) === cible) collect(l.lines)
  }
  return ids
}

export async function testMixte(): Promise<Resultat[]> {
  const res: Resultat[] = []

  // 4 facades : 2 ITE (motif du modele ITE), 2 ravalement (motif du modele rav).
  const facades = [
    { nom: 'Facade Nord', modeleId: ID_ITE, modeleLines: MODELE_FABRIQUE },
    { nom: 'Facade Sud', modeleId: ID_ITE, modeleLines: MODELE_FABRIQUE },
    { nom: 'Facade Est', modeleId: ID_RAV, modeleLines: MODELE_FABRIQUE_RAVALEMENT },
    { nom: 'Facade Ouest', modeleId: ID_RAV, modeleLines: MODELE_FABRIQUE_RAVALEMENT },
  ]
  // Modele de BASE = ITE (fournit Installation / Dechets / Eco + l'emplacement facade).
  const sections = deriverSectionsMixte(facades, MODELE_FABRIQUE)
  const get = (nom: string) => sections.find((s) => s.nom === nom)

  // Pre-derivation : les facades ravalement portent le motif RAV (prod_rav), pas ITE.
  const estArt = get('Facade Est')?.articles.map((a) => a.ref_modele) ?? []
  res.push(
    estArt.includes(`facade@${ID_RAV}:prod_rav#0`) &&
      !estArt.some((r) => (r ?? '').includes('prod_ite'))
      ? ok('A6 derivation : facade ravalement clone le motif RAV (pas ITE)')
      : ko('A6 derivation : facade ravalement clone le motif RAV', estArt.join(' | ')),
  )
  const nordArt = get('Facade Nord')?.articles.map((a) => a.ref_modele) ?? []
  res.push(
    nordArt.includes(`facade@${ID_ITE}:prod_ite#0`) &&
      !nordArt.some((r) => (r ?? '').includes('prod_rav'))
      ? ok('A6 derivation : facade ITE clone le motif ITE (pas ravalement)')
      : ko('A6 derivation : facade ITE clone le motif ITE', nordArt.join(' | ')),
  )

  // Saisie metres + edits d'Olivier.
  setQ(get('Installation'), 'entete:prod_ech#0', 200)
  setQ(get('Facade Nord'), `facade@${ID_ITE}:prod_ite#0`, 70)
  setQ(get('Facade Nord'), `facade@${ID_ITE}:prod_pse#0`, 70)
  setQ(get('Facade Nord'), `facade@${ID_ITE}:prod_dst#0`, 16)
  setQ(get('Facade Sud'), `facade@${ID_ITE}:prod_ite#0`, 50)
  setQ(get('Facade Sud'), `facade@${ID_ITE}:prod_pse#0`, 50)
  setQ(get('Facade Sud'), `facade@${ID_ITE}:prod_dst#0`, 10)
  setQ(get('Facade Est'), `facade@${ID_RAV}:prod_rav#0`, 40)
  setQ(get('Facade Est'), `facade@${ID_RAV}:prod_dst#0`, 8)
  // AJOUT d'un article sans ref dans une facade ravalement.
  const ajout: ArticleDevis = {
    costructor_article_id: 'prod_add', libelle: 'Poste ajoute par Olivier',
    unite: 'u', prix_vente: 100, quantite: 3, description_technique: '',
  }
  get('Facade Est')!.articles.push(ajout)
  // RENOMMAGE + SUPPRESSION du dessous-de-toit sur la facade Ouest.
  const ouest = get('Facade Ouest')!
  ouest.nom = 'Facade Ouest renommee'
  setQ(ouest, `facade@${ID_RAV}:prod_rav#0`, 30)
  ouest.articles = ouest.articles.filter((a) => a.ref_modele !== `facade@${ID_RAV}:prod_dst#0`)

  // Snapshot COMPOSITE : base = modele ITE (id ITE) ; modeles = { rav }.
  const snapshot = {
    id: ID_ITE,
    lines: MODELE_FABRIQUE,
    modeles: { [ID_RAV]: { lines: MODELE_FABRIQUE_RAVALEMENT } },
  }
  const lignes = reconstruireDepuisSnapshot(snapshot, sections)
  const arbre = aplatir(lignes as any[])

  // 1) Total au centime (verification independante).
  const total = sommeProduits(lignes)
  res.push(
    total === ATTENDU_CENTIMES
      ? ok('A6 totaux au centime', `${(total / 100).toFixed(2)} €`)
      : ko('A6 totaux au centime', `attendu ${ATTENDU_CENTIMES}, obtenu ${total}`),
  )

  // 2) ANTI-GOYAT : une facade ravalement ne contient QUE du ravalement (jamais ITE/PSE),
  //    une facade ITE ne contient QUE de l'ITE (jamais du ravalement).
  const est = produitsDuGroupe(lignes, 'Facade Est')
  const ouestR = produitsDuGroupe(lignes, 'Facade Ouest renommee')
  const nord = produitsDuGroupe(lignes, 'Facade Nord')
  res.push(
    est.includes('prod_rav') && !est.includes('prod_ite') && !est.includes('prod_pse')
      ? ok('A6 anti-Goyat : facade Est = ravalement pur (aucun poste ITE)')
      : ko('A6 anti-Goyat : facade Est ravalement pur', est.join(', ')),
  )
  res.push(
    ouestR.includes('prod_rav') && !ouestR.includes('prod_ite')
      ? ok('A6 anti-Goyat : facade Ouest (renommee) = ravalement pur')
      : ko('A6 anti-Goyat : facade Ouest ravalement pur', ouestR.join(', ')),
  )
  res.push(
    nord.includes('prod_ite') && nord.includes('prod_pse') && !nord.includes('prod_rav')
      ? ok('A6 anti-Goyat : facade Nord = ITE pur (isolant present, aucun ravalement)')
      : ko('A6 anti-Goyat : facade Nord ITE pur', nord.join(', ')),
  )

  // 3) TVA MIXTE ligne par ligne : ITE a 5,5 % (tx_55), ravalement a 10 % (tx_10).
  const iteTax = arbre.produits.find((p) => p.pid === 'prod_ite')?.taxId
  const ravTax = arbre.produits.find((p) => p.pid === 'prod_rav')?.taxId
  res.push(
    iteTax === 'tx_55' && ravTax === 'tx_10'
      ? ok('A6 TVA mixte ligne par ligne (ITE 5,5 % / ravalement 10 %)')
      : ko('A6 TVA mixte ligne par ligne', `ite=${iteTax} rav=${ravTax}`),
  )

  // 4) Comptages : 2 ITE (#1 non chauffee omise x2), 2 PSE, 2 RAV ; dst = 3
  //    (Nord+Sud+Est ; Ouest supprime) ; article ajoute present ; renommage effectif.
  const checks: Array<[string, boolean, string]> = [
    ['ITE occ=2 (partie non chauffee omise)', occ(arbre, 'prod_ite') === 2, `occ=${occ(arbre, 'prod_ite')}`],
    ['PSE occ=2', occ(arbre, 'prod_pse') === 2, `occ=${occ(arbre, 'prod_pse')}`],
    ['RAV occ=2', occ(arbre, 'prod_rav') === 2, `occ=${occ(arbre, 'prod_rav')}`],
    ['dessous-toit occ=3 (Ouest supprime)', occ(arbre, 'prod_dst') === 3, `occ=${occ(arbre, 'prod_dst')}`],
    ['article ajoute present', occ(arbre, 'prod_add') === 1, `occ=${occ(arbre, 'prod_add')}`],
    ['renommage Ouest effectif', arbre.groupes.includes('facade ouest renommee') && !arbre.groupes.includes('facade ouest'), arbre.groupes.join(' | ')],
    ['forfait eco present (qte defaut)', occ(arbre, 'prod_eco') === 1, `occ=${occ(arbre, 'prod_eco')}`],
  ]
  for (const [nom, cond, det] of checks) {
    res.push(cond ? ok(`A6 ${nom}`) : ko(`A6 ${nom}`, det))
  }

  // 5) RETRO-COMPAT : un snapshot SANS `modeles` (mono-modele historique) se
  //    reconstruit exactement comme avant (chemin legacy inchange).
  const legacySections = deriverSectionsDepuisModele(MODELE_FABRIQUE, ['Facade A'])
  const fa = legacySections.find((s) => s.nom === 'Facade A')
  setQ(fa, 'facade:prod_ite#0', 30)
  const legacyLignes = reconstruireDepuisSnapshot({ lines: MODELE_FABRIQUE }, legacySections)
  const legacyTotal = sommeProduits(legacyLignes)
  const legacyArbre = aplatir(legacyLignes as any[])
  res.push(
    legacyTotal > 0 && occ(legacyArbre, 'prod_ite') === 1 && legacyArbre.produits.find((p) => p.pid === 'prod_ite')?.taxId === 'tx_55'
      ? ok('A6 retro-compat : snapshot sans `modeles` = chemin mono-modele inchange')
      : ko('A6 retro-compat snapshot legacy', `total=${legacyTotal} occ_ite=${occ(legacyArbre, 'prod_ite')}`),
  )

  return res
}
