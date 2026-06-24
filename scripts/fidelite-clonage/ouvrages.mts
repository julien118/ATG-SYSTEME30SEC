// A5 - OUVRAGES hors-ligne : un modele portant une ligne OUVRAGE (work_detailed +
// supplies/cadence + déboursé) doit ressortir AU PUSH avec productType + supplies +
// buyPrice + persist:false, pour que Costructor recree l'ouvrage et calcule temps
// chantier + rentabilite. Une ligne NON-ouvrage (sans productType) reste plate
// (zero regression). PUR, aucun reseau — garde-fou du cablage champsOuvrage.

import {
  deriverSectionsDepuisModele,
  reconstruireDepuisSnapshot,
} from '../../lib/atg-devis-modele'
import { ko, ok, type Resultat } from './utils.mts'

// Modele minimal : 1 groupe facade avec (a) un OUVRAGE work_detailed (ITE) + 1
// supply main d'oeuvre (cadence 0.8), (b) une ligne PLATE (PSE, aucun productType).
function modeleAvecOuvrage(): any[] {
  return [
    {
      type: 'group',
      description: 'Façade',
      position: 0,
      lines: [
        {
          type: 'product', position: 0,
          description: 'Isolation thermique extérieure StarSystem',
          quantity: 1, sellPrice: 13000,
          unit: { id: 'unit_m2', symbol: 'm²' }, tax: { id: 'tx_10' },
          product: { id: 'prod_ite', name: 'ITE' },
          // --- nature OUVRAGE ---
          productType: 'work_detailed', sellPriceForced: false, buyPrice: 9000, source: 'batiprix', reference: 'REF1',
          supplies: [
            { id: 'pe_serveur', key: 'k_serveur', position: 0, quantity: 0.8, lockSellPrice: false,
              element: { id: 'prod_mo', name: "Main d'oeuvre", type: 'workforce', buyPrice: 4500, sellPrice: 6500 } },
          ],
        },
        {
          type: 'product', position: 1, description: 'Fourniture isolant PSE',
          quantity: 1, sellPrice: 5000,
          unit: { id: 'unit_m2', symbol: 'm²' }, tax: { id: 'tx_10' },
          product: { id: 'prod_plat', name: 'PSE' }, // pas de productType -> ligne plate
        },
      ],
    },
  ]
}

export async function testOuvrages(): Promise<Resultat[]> {
  const res: Resultat[] = []
  const modele = modeleAvecOuvrage()
  const sections = deriverSectionsDepuisModele(modele, ['Façade A'])
  for (const s of sections) for (const a of s.articles) a.quantite = 50 // metré dicté

  const lignes = reconstruireDepuisSnapshot({ lines: modele }, sections) as any[]
  const produits: any[] = []
  const walk = (ls: any[]) => { for (const l of ls || []) { if (l?.type === 'product') produits.push(l); if (l?.type === 'group') walk(l.lines) } }
  walk(lignes)
  const ouvrage = produits.find((p) => p.product === 'prod_ite')
  const plat = produits.find((p) => p.product === 'prod_plat')

  res.push(
    ouvrage ? ok('A5 ouvrage reconstruit (qté 50)') : ko('A5 ouvrage reconstruit', `produits=${produits.map((p) => p.product)}`),
  )
  res.push(
    ouvrage?.productType === 'work_detailed'
      ? ok('A5 ouvrage : productType "work_detailed" preserve')
      : ko('A5 ouvrage : productType preserve', JSON.stringify(ouvrage?.productType)),
  )
  const sup0 = ouvrage?.supplies?.[0]
  res.push(
    Array.isArray(ouvrage?.supplies) && ouvrage.supplies.length === 1 &&
      sup0.element?.id === 'prod_mo' && sup0.element?.name === "Main d'oeuvre" &&
      sup0.element?.type === 'workforce' &&
      sup0.element?.buyPrice === 4500 && sup0.element?.sellPrice === 6500 &&
      sup0.quantity === 0.8 && sup0.lockSellPrice === false &&
      !('id' in sup0) && !('key' in sup0)
      ? ok('A5 ouvrage : supply = element OBJET (Main d\'oeuvre/workforce, PA.U 45€/Prix U 65€) + cadence 0.8')
      : ko('A5 ouvrage : supplies', JSON.stringify(ouvrage?.supplies)),
  )
  res.push(
    ouvrage?.buyPrice === 9000 ? ok('A5 ouvrage : buyPrice (déboursé 90€) preserve') : ko('A5 ouvrage : buyPrice', JSON.stringify(ouvrage?.buyPrice)),
  )
  res.push(
    ouvrage?.source === 'batiprix' && ouvrage?.persist === false && ouvrage?.sellPriceForced === false
      ? ok('A5 ouvrage : source + persist:false + sellPriceForced:false (deboursé/rentabilite OK)')
      : ko('A5 ouvrage : source/persist/forced', JSON.stringify({ source: ouvrage?.source, persist: ouvrage?.persist, forced: ouvrage?.sellPriceForced })),
  )
  res.push(
    plat && plat.productType === undefined && plat.supplies === undefined && plat.buyPrice === undefined && plat.sellPriceForced === undefined
      ? ok('A5 ligne plate : aucun champ ouvrage (non-regression)')
      : ko('A5 ligne plate non-regression', JSON.stringify({ pt: plat?.productType, sup: plat?.supplies, bp: plat?.buyPrice, f: plat?.sellPriceForced })),
  )
  return res
}
