// C3 - E2E REORDONNANCEMENT sur le COMPTE TEST : derive les sections d'un modele,
// les REORDONNE (comme Olivier avec les fleches ▲▼ / le glisser), POUSSE un vrai
// brouillon dans Costructor, le RELIT et verifie que l'ordre des GROUPES poussés
// correspond EXACTEMENT a l'ordre choisi. Supprime le brouillon (try/finally :
// aucun orphelin). Ecriture compte test uniquement via pousserLignesGroupe
// (assertCompteJulien). SKIP si cle test ou map.json absents. C'est la preuve
// bout-en-bout que « reordonner dans l'app » se retrouve dans le devis Costructor.

import { existsSync, readFileSync } from 'node:fs'
import { selectionnerModele, type ModeleDevis } from '../../lib/atg-routing'
import {
  deriverSectionsDepuisModele,
  getModeleExpand,
  listerModeles,
  pousserLignesGroupe,
  reconstruireDepuisSnapshot,
} from '../../lib/atg-devis-modele'
import { deplacerSection } from '../../lib/devis-sections-ordre'
import { supprimerDevis } from '../../lib/costructor'
import type { SectionDevis } from '../../lib/types'
import { aplatir, ko, norm, ok, reessayer429, skip, type Resultat } from './utils.mts'

const MAP = 'data/clone-olivier-julien/map.json'
const DICTEE_ITE = "ITE isolation thermique par l'exterieur PSE garantie decennale, partie chauffee et non chauffee"
const NOMS_FACADES = ['Facade principale', 'Facade arriere']

export async function testE2eOrdre(): Promise<Resultat[]> {
  if (!process.env.COSTRUCTOR_API_KEY) return [skip('C3 e2e ordre', 'COSTRUCTOR_API_KEY (compte test) absente')]
  if (!existsSync(MAP)) return [skip('C3 e2e ordre', `${MAP} absent (donnee de test locale)`)]

  const customer = Object.values(JSON.parse(readFileSync(MAP, 'utf8')).contacts)[0] as string
  const modeles: ModeleDevis[] = (await listerModeles()).map((m: any) => ({
    id: m.id, name: m.name ?? null, description: m.description ?? null, total: m.total ?? null, model: !!m.model,
  }))
  const routage = selectionnerModele(DICTEE_ITE, modeles)
  if (!routage.modeleId) return [ko('C3 e2e ordre', 'aucun modele ITE sur le compte test')]
  const snapshot = await getModeleExpand(routage.modeleId)

  let sections: SectionDevis[] = deriverSectionsDepuisModele(snapshot.lines ?? [], NOMS_FACADES)
  // Saisie : tous les metres a 5 (sinon section vide = non poussee).
  for (const s of sections) for (const a of s.articles) if (a.quantite === null) a.quantite = 5
  if (sections.length < 2) return [skip('C3 e2e ordre', `modele a ${sections.length} section(s) : rien a reordonner`)]

  // Ordre par defaut, puis REORDONNANCEMENT : on remonte la DERNIERE section en
  // TETE (comme Olivier qui clique « monter » a repetition, ou glisse la section).
  const ordreInitial = sections.map((s) => norm(s.nom))
  sections = deplacerSection(sections, sections.length - 1, 0)
  const ordreVoulu = sections.map((s) => norm(s.nom))

  const lignes = reconstruireDepuisSnapshot(snapshot, sections)

  const res: Resultat[] = []
  let creeId = ''
  try {
    const cree = await reessayer429(() =>
      pousserLignesGroupe({ customer, description: 'SUITE FIDELITE C3 ordre (brouillon a supprimer)', lines: lignes }),
    )
    creeId = cree.id
    const relu = await getModeleExpand(creeId)
    // Ordre des groupes RELU depuis Costructor, filtre a nos sections (par nom).
    const groupesCostructor = aplatir(relu.lines ?? []).groupes
    const groupesNosSections = groupesCostructor.filter((g) => ordreVoulu.includes(g))

    const conforme =
      groupesNosSections.length === ordreVoulu.length &&
      ordreVoulu.every((nom, i) => groupesNosSections[i] === nom)
    res.push(
      conforme
        ? ok('C3 ordre Costructor = ordre choisi', `[${groupesNosSections.join(' > ')}]`)
        : ko('C3 ordre Costructor = ordre choisi', `voulu [${ordreVoulu.join(' > ')}] | Costructor [${groupesNosSections.join(' > ')}]`),
    )
    res.push(
      JSON.stringify(ordreInitial) !== JSON.stringify(ordreVoulu)
        ? ok('C3 reordonnancement effectif (ordre != defaut)', `defaut [${ordreInitial.join(' > ')}]`)
        : skip('C3 reordonnancement effectif', 'ordre inchange'),
    )
  } catch (e) {
    res.push(ko('C3 e2e ordre', (e as Error).message))
  } finally {
    if (creeId) await supprimerDevis(creeId) // NETTOYAGE garanti (compte test)
  }
  return res
}
