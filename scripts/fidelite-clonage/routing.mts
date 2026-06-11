// A1 - Routing (aiguillage) : PUR, aucun reseau. Verifie que selectionnerModele
// + la regle d'aiguillage de la route (famille ITE franche margeFamille>=2 + un
// modele ITE trouve) envoient l'ITE vers le clonage, et le ravalement / l'ambigu
// vers le moteur plat.

import { selectionnerModele, type ModeleDevis } from '../../lib/atg-routing'
import { ko, ok, type Resultat } from './utils.mts'

// Liste de modeles fabriquee (pas d'API), representative du compte d'Olivier : un
// ITE detaille (garantie decennale), un ITE standard (StarSystem), un ravalement I3.
const MODELES: ModeleDevis[] = [
  { id: 'm_ite_det', name: 'ITE det', description: "Travaux d'isolation thermique par l'exterieur, garantie decennale", total: 400000, model: true },
  { id: 'm_ite_std', name: 'ITE std', description: "Isolation thermique par l'exterieur", total: 250000, model: true },
  { id: 'm_rav', name: 'Rav', description: 'Ravalement I3 peinture', total: 90000, model: true },
]

// Replique la regle d'aiguillage de app/api/devis/proposer/route.ts.
function aiguillage(dictee: string): 'clonage' | 'plat' {
  const r = selectionnerModele(dictee, MODELES)
  const iteConfiant = r.famille === 'ite' && r.margeFamille >= 2 && !!r.modeleId
  return iteConfiant ? 'clonage' : 'plat'
}

const CAS: Array<{ nom: string; dictee: string; attendu: 'clonage' | 'plat' }> = [
  { nom: 'ITE detaillee -> clonage', dictee: "ITE isolation thermique par l'exterieur PSE garantie decennale, deux facades", attendu: 'clonage' },
  { nom: 'ITE StarSystem -> clonage', dictee: "isolation par l'exterieur systeme StarSystem sur la maison", attendu: 'clonage' },
  { nom: 'Ravalement I3 -> plat', dictee: 'ravalement I3 finition peinture, fissures a reprendre', attendu: 'plat' },
  { nom: 'Ambigu (toiture) -> plat', dictee: 'refection de la toiture et des gouttieres', attendu: 'plat' },
  { nom: 'Piege "pas d ITE" -> plat', dictee: "ravalement peinture, surtout pas d'isolation, le client ne veut pas d'ITE", attendu: 'plat' },
]

export async function testRouting(): Promise<Resultat[]> {
  return CAS.map((c) => {
    const got = aiguillage(c.dictee)
    return got === c.attendu
      ? ok(`A1 routing : ${c.nom}`)
      : ko(`A1 routing : ${c.nom}`, `attendu ${c.attendu}, obtenu ${got}`)
  })
}
