// B1 - Fidelite replique (compte test) <-> vrai modele Olivier. LECTURE SEULE
// STRICTE : GET only sur les deux comptes, aucune ecriture, aucun push. Les
// product.id / tax.id different entre comptes (normal) : on assert la STRUCTURE
// (nb groupes, nb lignes, libelles, unites, TVA) ; les PRIX sont en TOLERANCE
// (signales en info, jamais un echec : Olivier fait evoluer ses tarifs).
// SKIP si la cle Olivier (ou la cle test) est absente.

import { selectionnerModele, type ModeleDevis } from '../../lib/atg-routing'
import { getDevisOlivierLectureSeule, getModeleExpand, listerModeles } from '../../lib/atg-devis-modele'
import { aplatir, ko, norm, ok, skip, type Resultat } from './utils.mts'

const DICTEE_ITE = "ITE isolation thermique par l'exterieur PSE garantie decennale, partie chauffee et non chauffee"

function choisir(raw: any[]): ModeleDevis | null {
  const modeles: ModeleDevis[] = raw.map((m: any) => ({
    id: m.id, name: m.name ?? null, description: m.description ?? null, total: m.total ?? null, model: !!m.model,
  }))
  const r = selectionnerModele(DICTEE_ITE, modeles)
  return r.modeleId ? modeles.find((m) => m.id === r.modeleId) ?? null : null
}

export async function testFideliteModele(): Promise<Resultat[]> {
  if (!process.env.COSTRUCTOR_API_KEY) return [skip('B1 fidelite modele', 'COSTRUCTOR_API_KEY (compte test) absente')]
  if (!process.env.COSTRUCTOR_API_KEY_OLIVIER) return [skip('B1 fidelite modele', 'COSTRUCTOR_API_KEY_OLIVIER absente')]

  // Cote compte TEST (replique).
  const mTest = choisir(await listerModeles())
  if (!mTest) return [ko('B1 fidelite modele', 'aucun modele ITE sur le compte test')]
  const arbreTest = aplatir((await getModeleExpand(mTest.id)).lines ?? [])

  // Cote OLIVIER (vrai modele) - GET STRICT.
  const quotesOlivier = (await getDevisOlivierLectureSeule('/quotes?_limit=1000')) as any[]
  const mOlivier = choisir(quotesOlivier.filter((q) => q.model))
  if (!mOlivier) return [ko('B1 fidelite modele', 'aucun modele ITE chez Olivier')]
  const arbreOlivier = aplatir((await getDevisOlivierLectureSeule(`/quotes/${mOlivier.id}?_expand=lines`)).lines ?? [])

  const res: Resultat[] = []

  // Structure : nb groupes + nb lignes produit (assertion dure).
  res.push(
    arbreTest.groupes.length === arbreOlivier.groupes.length
      ? ok('B1 structure : meme nombre de groupes', `${arbreTest.groupes.length}`)
      : ko('B1 structure : meme nombre de groupes', `test=${arbreTest.groupes.length} olivier=${arbreOlivier.groupes.length}`),
  )
  res.push(
    arbreTest.produits.length === arbreOlivier.produits.length
      ? ok('B1 structure : meme nombre de lignes produit', `${arbreTest.produits.length}`)
      : ko('B1 structure : meme nombre de lignes produit', `test=${arbreTest.produits.length} olivier=${arbreOlivier.produits.length}`),
  )

  // Ligne a ligne (par position) : libelle, unite, TVA = dur ; prix = info.
  const n = Math.min(arbreTest.produits.length, arbreOlivier.produits.length)
  let structDiffs = 0
  let prixDiffs = 0
  const exemplesPrix: string[] = []
  for (let i = 0; i < n; i++) {
    const a = arbreTest.produits[i]
    const b = arbreOlivier.produits[i]
    if (norm(a.desc) !== norm(b.desc) || a.unit !== b.unit || a.taxRate !== b.taxRate) structDiffs++
    if (a.sellPrice !== b.sellPrice) {
      prixDiffs++
      if (exemplesPrix.length < 3)
        exemplesPrix.push(`[${i}] ${a.sellPrice}c vs ${b.sellPrice}c "${b.desc.slice(0, 30)}"`)
    }
  }
  res.push(
    structDiffs === 0
      ? ok('B1 structure : libelles / unites / TVA identiques ligne par ligne')
      : ko('B1 structure : libelles / unites / TVA identiques ligne par ligne', `${structDiffs} ligne(s) divergente(s)`),
  )
  // Prix : INFO uniquement (tolerance), jamais un echec.
  res.push(
    ok(
      'B1 prix (tolerance, info)',
      prixDiffs === 0
        ? 'aucun ecart de prix'
        : `${prixDiffs} ecart(s) de prix (normal si Olivier a fait evoluer ses tarifs) : ${exemplesPrix.join(' ; ')}`,
    ),
  )

  return res
}
