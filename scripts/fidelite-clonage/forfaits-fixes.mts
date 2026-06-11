// C2 - Forfaits fixes : 3 scenarios sur le COMPTE TEST. Verifie que les forfaits
// fixes (pre-remplis a la derivation) sont (1) presents a la qte modele s'ils ne
// sont pas saisis, (2) ABSENTS si Olivier les vide (defaut, pas verrou), (3)
// pousses a la valeur s'il les edite. Chaque scenario pousse un brouillon puis le
// SUPPRIME (try/finally). SKIP si cle test ou map.json absents.

import { existsSync, readFileSync } from 'node:fs'
import { selectionnerModele, type ModeleDevis } from '../../lib/atg-routing'
import {
  deriverSectionsDepuisModele,
  getModeleExpand,
  listerModeles,
  pousserLignesGroupe,
  reconstruireDepuisSnapshot,
} from '../../lib/atg-devis-modele'
import { supprimerDevis } from '../../lib/costructor'
import type { ArticleDevis, SectionDevis } from '../../lib/types'
import { aplatir, ko, ok, qtes, reessayer429, skip, type Resultat } from './utils.mts'

const MAP = 'data/clone-olivier-julien/map.json'
const DICTEE_ITE = "ITE isolation thermique par l'exterieur PSE garantie decennale"
const NOMS_FACADES = ['Facade principale', 'Facade arriere']

export async function testForfaitsFixes(): Promise<Resultat[]> {
  if (!process.env.COSTRUCTOR_API_KEY) return [skip('C2 forfaits fixes', 'COSTRUCTOR_API_KEY (compte test) absente')]
  if (!existsSync(MAP)) return [skip('C2 forfaits fixes', `${MAP} absent (donnee de test locale)`)]

  const customer = Object.values(JSON.parse(readFileSync(MAP, 'utf8')).contacts)[0] as string
  const modeles: ModeleDevis[] = (await listerModeles()).map((m: any) => ({
    id: m.id, name: m.name ?? null, description: m.description ?? null, total: m.total ?? null, model: !!m.model,
  }))
  const routage = selectionnerModele(DICTEE_ITE, modeles)
  if (!routage.modeleId) return [ko('C2 forfaits fixes', 'aucun modele ITE sur le compte test')]
  const snapshot = await getModeleExpand(routage.modeleId)

  // Pousse un scenario (mutation appliquee aux forfaits pre-remplis), relit, nettoie.
  async function scenario(
    appliquer: (forfaits: ArticleDevis[]) => void,
  ): Promise<{ forfaits: ArticleDevis[]; arbre: ReturnType<typeof aplatir> }> {
    const sections: SectionDevis[] = deriverSectionsDepuisModele(snapshot.lines ?? [], NOMS_FACADES)
    const forfaits = sections.flatMap((s) => s.articles).filter((a) => a.quantite !== null)
    for (const s of sections) for (const a of s.articles) if (a.quantite === null) a.quantite = 5
    appliquer(forfaits)
    const lignes = reconstruireDepuisSnapshot(snapshot, sections)
    let id = ''
    try {
      const cree = await reessayer429(() =>
        pousserLignesGroupe({ customer, description: 'SUITE FIDELITE C2 (brouillon a supprimer)', lines: lignes }),
      )
      id = cree.id
      const relu = await getModeleExpand(id)
      return { forfaits, arbre: aplatir(relu.lines ?? []) }
    } finally {
      if (id) await supprimerDevis(id)
    }
  }

  const res: Resultat[] = []

  // 1) DEFAUT : forfaits non touches -> presents a la qte modele.
  const s1 = await scenario(() => {})
  if (s1.forfaits.length === 0) {
    res.push(skip('C2 forfaits fixes', 'ce modele ne porte aucun forfait fixe (rien a verifier)'))
    return res
  }
  let defautOk = true
  for (const f of s1.forfaits) if (!qtes(s1.arbre, f.costructor_article_id).includes(f.quantite as number)) defautOk = false
  res.push(defautOk ? ok('C2 defaut : forfaits non saisis presents a la qte modele') : ko('C2 defaut : forfaits non saisis presents a la qte modele'))

  // 2) RETIRE : Olivier vide le forfait -> ABSENT (pas un verrou).
  const s2 = await scenario((forfaits) => { for (const f of forfaits) f.quantite = null })
  let retireOk = true
  for (const f of s2.forfaits) if (qtes(s2.arbre, f.costructor_article_id).length !== 0) retireOk = false
  res.push(retireOk ? ok('C2 retire : forfait vide ABSENT (defaut, pas verrou)') : ko('C2 retire : forfait vide ABSENT'))

  // 3) EDITE : Olivier change la quantite -> poussee.
  const s3 = await scenario((forfaits) => { for (const f of forfaits) f.quantite = 4 })
  let editOk = true
  for (const f of s3.forfaits) if (!qtes(s3.arbre, f.costructor_article_id).includes(4)) editOk = false
  res.push(editOk ? ok('C2 edite : forfait pousse a la valeur saisie (editable)') : ko('C2 edite : forfait pousse a la valeur saisie'))

  return res
}
