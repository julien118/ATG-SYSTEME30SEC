// A2 - Reconstruction HORS-LIGNE : PUR, aucun reseau. A partir du modele fabrique,
// derive les sections, simule la saisie d'Olivier + ses edits (renommer /
// supprimer / ajouter / vider), reconstruit l'arbre et verifie de facon
// deterministe : totaux au centime, sous-titres (option b) + abandon orphelin,
// forfaits pre-remplis, refs honorees, edits respectes. C'est le garde-fou de
// regression le plus fiable du coeur du moteur (il tourne sans Costructor).

import {
  deriverSectionsDepuisModele,
  reconstruireDepuisSnapshot,
  sommeProduits,
} from '../../lib/atg-devis-modele'
import { deplacerSection } from '../../lib/devis-sections-ordre'
import type { ArticleDevis, SectionDevis } from '../../lib/types'
import { aplatir, ko, MODELE_FABRIQUE, occ, ok, qtes, type Resultat } from './utils.mts'

// Total attendu (calcule a la main depuis le modele fabrique + les quantites
// saisies ci-dessous), en centimes. Verification INDEPENDANTE de sommeProduits.
//   echafaudage 1000 x 200                     = 200000
//   Facade A : ITE 13000 x 70 = 910000 ; PSE 5000 x 70 = 350000 ;
//              ITE#1 (non chauffee) vide -> 0 ; dessous-toit 2000 x 16 = 32000 ;
//              ajout 4000 x 10 = 40000
//   Facade B : ITE 13000 x 50 = 650000 ; PSE 5000 x 50 = 250000 ;
//              ITE#1 vide -> 0 ; dessous-toit SUPPRIME -> 0
//   Dechets (forfait) 30000 x 1 = 30000 ; Eco (forfait) 500 x 1 = 500
const ATTENDU_CENTIMES = 2462500

function setQ(s: SectionDevis, ref: string, q: number | null) {
  const a = s.articles.find((x) => x.ref_modele === ref)
  if (a) a.quantite = q
}

export async function testReconstruction(): Promise<Resultat[]> {
  const res: Resultat[] = []
  const sections = deriverSectionsDepuisModele(MODELE_FABRIQUE, ['Facade A', 'Facade B'])
  const get = (nom: string) => sections.find((s) => s.nom === nom)

  // Verifie d'abord la pre-derivation : forfaits pre-remplis, metres a null.
  const dechets = get('Déchets')?.articles.find((a) => a.ref_modele === 'autre:prod_benne#0')
  const eco = get('Éco-contribution')?.articles.find((a) => a.ref_modele === 'eco:prod_eco#0')
  res.push(
    dechets?.quantite === 1 && eco?.quantite === 1
      ? ok('A2 derivation : forfaits fixes pre-remplis (dechets=1, eco=1)')
      : ko('A2 derivation : forfaits fixes pre-remplis', `dechets=${dechets?.quantite} eco=${eco?.quantite}`),
  )

  // Saisie des metres + edits d'Olivier.
  const inst = get('Installation')!
  setQ(inst, 'entete:prod_ech#0', 200)
  const fa = get('Facade A')!
  setQ(fa, 'facade:prod_ite#0', 70)
  setQ(fa, 'facade:prod_pse#0', 70)
  // ITE#1 (partie non chauffee) laisse VIDE -> doit etre omis + sous-titre orphelin
  setQ(fa, 'facade:prod_dst#0', 16)
  // AJOUT d'un article sans ref (taux dominant)
  const ajout: ArticleDevis = {
    costructor_article_id: 'prod_ajout', libelle: 'Article ajoute par Olivier',
    unite: 'u', prix_vente: 40, quantite: 10, description_technique: '',
  }
  fa.articles.push(ajout)
  const fb = get('Facade B')!
  fb.nom = 'Facade B renommee' // RENOMMAGE
  setQ(fb, 'facade:prod_ite#0', 50)
  setQ(fb, 'facade:prod_pse#0', 50)
  fb.articles = fb.articles.filter((a) => a.ref_modele !== 'facade:prod_dst#0') // SUPPRESSION

  const lignes = reconstruireDepuisSnapshot({ lines: MODELE_FABRIQUE }, sections)
  const arbre = aplatir(lignes as any[])

  // 1) Totaux au centime (verification independante).
  const total = sommeProduits(lignes)
  res.push(
    total === ATTENDU_CENTIMES
      ? ok('A2 totaux au centime', `${(total / 100).toFixed(2)} €`)
      : ko('A2 totaux au centime', `attendu ${ATTENDU_CENTIMES}, obtenu ${total}`),
  )

  // 2) Sous-titres (option b) + abandon orphelin : "partie chauffee" presente
  //    (ITE#0 conserve), "partie non chauffee" ABSENTE (ITE#1 vide -> orphelin).
  const chauffeePresente = arbre.textes.some((t) => t.includes('partie chauffee'))
  const nonChauffeeAbsente = !arbre.textes.some((t) => t.includes('partie non chauffee'))
  res.push(
    chauffeePresente && nonChauffeeAbsente
      ? ok('A2 sous-titres option b + abandon orphelin')
      : ko('A2 sous-titres option b + abandon orphelin', `chauffee=${chauffeePresente} nonChauffeeAbsente=${nonChauffeeAbsente}`),
  )

  // 3) Renommage respecte + ancien nom absent.
  const renomOk = arbre.groupes.includes('facade b renommee') && !arbre.groupes.includes('facade b')
  res.push(renomOk ? ok('A2 renommage de section') : ko('A2 renommage de section', arbre.groupes.join(' | ')))

  // 4) Comptages : ITE#1 vide omis (2 ITE au lieu de 4), dessous-toit supprime en
  //    Facade B (1 occurrence), ajout present, forfaits a la qte defaut.
  const checks: Array<[string, boolean, string]> = [
    ['ITE non chauffee omise (occ=2)', occ(arbre, 'prod_ite') === 2, `occ=${occ(arbre, 'prod_ite')}`],
    ['dessous-toit supprime en Facade B (occ=1)', occ(arbre, 'prod_dst') === 1, `occ=${occ(arbre, 'prod_dst')}`],
    ['article ajoute present', occ(arbre, 'prod_ajout') === 1, `occ=${occ(arbre, 'prod_ajout')}`],
    ['echafaudage saisi (qte=200)', qtes(arbre, 'prod_ech').includes(200), `qtes=${qtes(arbre, 'prod_ech')}`],
    ['forfait dechets defaut (qte=1)', qtes(arbre, 'prod_benne').includes(1), `qtes=${qtes(arbre, 'prod_benne')}`],
    ['forfait eco defaut (qte=1)', qtes(arbre, 'prod_eco').includes(1), `qtes=${qtes(arbre, 'prod_eco')}`],
  ]
  for (const [nom, cond, det] of checks) {
    res.push(cond ? ok(`A2 ${nom}`) : ko(`A2 ${nom}`, det))
  }

  return res
}

// A4 - REORDONNANCEMENT HORS-LIGNE : verifie que l'ordre des sections choisi par
// Olivier dans l'app (ordre du tableau sections_finales) se retrouve dans l'arbre
// reconstruit AU PUSH — y compris a travers les origines (une facade peut passer
// avant le transversal) et pour une section ajoutee de zero intercalee au milieu
// (resout le bug « toujours en fin »). Garde-fous : ordre par defaut = ordre
// modele (zero regression), en-tete QUALIFICATIONS en preambule, total inchange
// par un reordonnancement, refs #0/#1 par facade preservees. PUR, aucun reseau.
export async function testReordonnancement(): Promise<Resultat[]> {
  const res: Resultat[] = []

  // Derive des sections fraiches + remplit le minimum de quantites pour que chaque
  // groupe soit non vide (Installation, Facade A, Facade B ; Dechets/Eco = forfaits
  // deja pre-remplis a la derivation).
  function preparer(): SectionDevis[] {
    const s = deriverSectionsDepuisModele(MODELE_FABRIQUE, ['Facade A', 'Facade B'])
    const set = (nom: string, ref: string, q: number) => {
      const a = s.find((x) => x.nom === nom)?.articles.find((x) => x.ref_modele === ref)
      if (a) a.quantite = q
    }
    set('Installation', 'entete:prod_ech#0', 200)
    set('Facade A', 'facade:prod_ite#0', 70)
    set('Facade B', 'facade:prod_ite#0', 50)
    return s
  }

  const reconstruire = (sections: SectionDevis[]) =>
    aplatir(reconstruireDepuisSnapshot({ lines: MODELE_FABRIQUE }, sections) as any[])
  const ordreGroupes = (sections: SectionDevis[]) => reconstruire(sections).groupes

  const base = preparer()
  const attenduBase = ['installation', 'facade a', 'facade b', 'dechets', 'eco-contribution']

  // 1) Ordre par defaut (aucun reordonnancement) = ordre du modele : ZERO regression.
  const gBase = ordreGroupes(base)
  res.push(
    JSON.stringify(gBase) === JSON.stringify(attenduBase)
      ? ok('A4 ordre par defaut = ordre modele (non regression)')
      : ko('A4 ordre par defaut', `obtenu ${gBase.join(' | ')}`),
  )

  // 2) En-tete QUALIFICATIONS en preambule (1er texte, avant tout groupe).
  const t0 = reconstruire(base).textes[0] ?? ''
  res.push(
    t0.includes('qualifications')
      ? ok('A4 en-tete QUALIFICATIONS en preambule')
      : ko('A4 en-tete QUALIFICATIONS en preambule', `textes[0]=${t0}`),
  )

  // 3) Reorganisation INTRA-origine : Facade B remontee avant Facade A.
  const gIntra = ordreGroupes(deplacerSection(base, 2, 1))
  res.push(
    gIntra.indexOf('facade b') < gIntra.indexOf('facade a') && gIntra[0] === 'installation'
      ? ok('A4 reorg intra-origine (Facade B avant Facade A)')
      : ko('A4 reorg intra-origine', gIntra.join(' | ')),
  )
  // refs #0/#1 par facade preservees apres reorg : les 2 ITE gardent leurs qtes.
  const itesIntra = qtes(reconstruire(deplacerSection(base, 2, 1)), 'prod_ite').slice().sort((a, b) => a - b)
  res.push(
    JSON.stringify(itesIntra) === JSON.stringify([50, 70])
      ? ok('A4 refs facade preservees apres reorg (ITE 50 & 70)')
      : ko('A4 refs facade preservees apres reorg', `ites=${itesIntra}`),
  )

  // 4) Reorganisation INTER-origine : Dechets remonte tout en tete (avant Installation).
  const gInter = ordreGroupes(deplacerSection(base, 3, 0))
  res.push(
    gInter[0] === 'dechets' && gInter.indexOf('dechets') < gInter.indexOf('installation')
      ? ok('A4 reorg inter-origine (Dechets avant Installation)')
      : ko('A4 reorg inter-origine', gInter.join(' | ')),
  )

  // 5) Section AJOUTEE de zero intercalee au MILIEU (bug « toujours en fin » resolu).
  const nouvelle: SectionDevis = {
    nom: 'Section ajoutee',
    articles: [
      { costructor_article_id: 'prod_new', libelle: 'Poste sur mesure', unite: 'u', prix_vente: 100, quantite: 3, description_technique: '' },
    ],
  }
  const intercalee = [...base.slice(0, 2), nouvelle, ...base.slice(2)]
  const gInter2 = ordreGroupes(intercalee)
  res.push(
    gInter2[2] === 'section ajoutee'
      ? ok('A4 section ajoutee intercalee au milieu (plus « en fin »)')
      : ko('A4 section ajoutee intercalee', gInter2.join(' | ')),
  )

  // 6) Total INCHANGE par un reordonnancement (les montants ne dependent pas de l'ordre).
  const tBase = sommeProduits(reconstruireDepuisSnapshot({ lines: MODELE_FABRIQUE }, base))
  const tReord = sommeProduits(reconstruireDepuisSnapshot({ lines: MODELE_FABRIQUE }, deplacerSection(base, 3, 0)))
  res.push(
    tBase > 0 && tBase === tReord
      ? ok('A4 total inchange par reordonnancement', `${(tBase / 100).toFixed(2)} €`)
      : ko('A4 total inchange par reordonnancement', `base=${tBase} reord=${tReord}`),
  )

  // 7) deplacerSection : bornes & no-op (meme reference si pas de mouvement valide).
  const noOp =
    deplacerSection(base, 0, 0) === base &&
    deplacerSection(base, -1, 2) === base &&
    deplacerSection(base, 0, 99) === base &&
    deplacerSection(base, 1, 2) !== base
  res.push(noOp ? ok('A4 deplacerSection bornes/no-op') : ko('A4 deplacerSection bornes/no-op'))

  return res
}
