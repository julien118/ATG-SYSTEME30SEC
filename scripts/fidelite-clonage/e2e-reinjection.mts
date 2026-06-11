// C1 - Cycle complet clone -> push -> relecture -> comparaison, sur le COMPTE
// TEST. Clone un modele ITE, remplit des quantites connues, simule des edits
// d'Olivier (renommer / supprimer / ajouter), pousse un BROUILLON, relit, compare
// structure + totaux au centime + TVA ligne par ligne, puis SUPPRIME le brouillon
// (try/finally : aucun orphelin meme en cas d'echec). Ecriture compte test
// uniquement via pousserLignesGroupe (assertCompteJulien). SKIP si cle test ou
// map.json absents.

import { existsSync, readFileSync } from 'node:fs'
import { selectionnerModele, type ModeleDevis } from '../../lib/atg-routing'
import {
  deriverSectionsDepuisModele,
  getModeleExpand,
  listerModeles,
  listerProduitsPlats,
  pousserLignesGroupe,
  reconstruireDepuisSnapshot,
  sommeProduits,
} from '../../lib/atg-devis-modele'
import { supprimerDevis } from '../../lib/costructor'
import type { ArticleDevis, SectionDevis } from '../../lib/types'
import { aplatir, ko, occ, ok, reessayer429, skip, type Resultat } from './utils.mts'

const MAP = 'data/clone-olivier-julien/map.json'
const DICTEE_ITE = "ITE isolation thermique par l'exterieur PSE garantie decennale, partie chauffee et non chauffee"
const NOMS_FACADES = ['Facade principale', 'Facade arriere']

// TVA du modele par pid (1re occurrence) pour controler la recopie ligne par ligne.
function taxesModele(lines: any[]): Map<string, string> {
  const parPid = new Map<string, string>()
  const walk = (ls: any[]) => {
    for (const l of ls ?? []) {
      if (l.type === 'product' && l.product?.id && l.tax?.id && !parPid.has(l.product.id)) parPid.set(l.product.id, l.tax.id)
      if (l.type === 'group') walk(l.lines)
    }
  }
  walk(lines)
  return parPid
}

export async function testE2eReinjection(): Promise<Resultat[]> {
  if (!process.env.COSTRUCTOR_API_KEY) return [skip('C1 e2e reinjection', 'COSTRUCTOR_API_KEY (compte test) absente')]
  if (!existsSync(MAP)) return [skip('C1 e2e reinjection', `${MAP} absent (donnee de test locale)`)]

  const customer = Object.values(JSON.parse(readFileSync(MAP, 'utf8')).contacts)[0] as string
  const modeles: ModeleDevis[] = (await listerModeles()).map((m: any) => ({
    id: m.id, name: m.name ?? null, description: m.description ?? null, total: m.total ?? null, model: !!m.model,
  }))
  const routage = selectionnerModele(DICTEE_ITE, modeles)
  if (!routage.modeleId) return [ko('C1 e2e reinjection', 'aucun modele ITE sur le compte test')]
  const snapshot = await getModeleExpand(routage.modeleId)

  const sections: SectionDevis[] = deriverSectionsDepuisModele(snapshot.lines ?? [], NOMS_FACADES)
  // Saisie : tous les metres a 5 ; edits ci-dessous.
  for (const s of sections) for (const a of s.articles) if (a.quantite === null) a.quantite = 5

  const facades = sections.filter((s) => s.articles.some((a) => a.ref_modele?.startsWith('facade:')))
  let pidSupprime = ''
  if (facades[1]?.articles.length) {
    const sup = facades[1].articles.shift() as ArticleDevis // SUPPRESSION (1re ligne facade 2)
    pidSupprime = sup.costructor_article_id
  }
  const NOUVEAU_NOM = 'Facade principale (renommee test)'
  if (facades[0]) facades[0].nom = NOUVEAU_NOM // RENOMMAGE
  const prod = (await listerProduitsPlats()).find((p: any) => p.id && (p.sellPrice ?? 0) > 0)
  const pidAjoute = (prod as any)?.id as string
  if (facades[0] && pidAjoute) {
    facades[0].articles.push({
      costructor_article_id: pidAjoute, libelle: 'AJOUT test', unite: 'u',
      prix_vente: ((prod as any).sellPrice ?? 1000) / 100, quantite: 3, description_technique: '',
    })
  }

  const lignes = reconstruireDepuisSnapshot(snapshot, sections)
  const attendu = sommeProduits(lignes)

  const res: Resultat[] = []
  let creeId = ''
  try {
    const cree = await reessayer429(() =>
      pousserLignesGroupe({ customer, description: 'SUITE FIDELITE C1 (brouillon a supprimer)', lines: lignes }),
    )
    creeId = cree.id
    const relu = await getModeleExpand(creeId)
    const arbre = aplatir(relu.lines ?? [])
    const parPid = taxesModele(snapshot.lines ?? [])

    res.push(
      relu.subtotal === attendu && arbre.produits.reduce((s, p) => s + p.subtotal, 0) === relu.subtotal
        ? ok('C1 totaux au centime', `${(relu.subtotal / 100).toFixed(2)} €`)
        : ko('C1 totaux au centime', `attendu ${attendu}, relu ${relu.subtotal}`),
    )
    res.push(
      arbre.groupes.includes(NOUVEAU_NOM.toLowerCase()) ? ok('C1 renommage de section') : ko('C1 renommage de section', arbre.groupes.join(' | ')),
    )
    res.push(arbre.textes.length > 0 ? ok('C1 sous-titres internes presents') : ko('C1 sous-titres internes presents', '0 ligne texte'))
    res.push(
      pidAjoute && occ(arbre, pidAjoute) >= 1 ? ok('C1 article ajoute present') : ko('C1 article ajoute present', `occ=${occ(arbre, pidAjoute)}`),
    )
    let tvaOk = true
    for (const p of arbre.produits) {
      if (p.pid === pidAjoute) continue
      if (parPid.has(p.pid) && p.taxId !== parPid.get(p.pid)) tvaOk = false
    }
    res.push(tvaOk ? ok('C1 TVA ligne par ligne conforme au modele') : ko('C1 TVA ligne par ligne conforme au modele'))
  } catch (e) {
    res.push(ko('C1 e2e reinjection', (e as Error).message))
  } finally {
    if (creeId) await supprimerDevis(creeId) // NETTOYAGE garanti (compte test)
  }
  void pidSupprime
  return res
}
