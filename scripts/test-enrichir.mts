// Couche 2 = test PUR (faux produits). Couche 1 = intégration (Claude réel sur un
// vrai modèle d'Olivier lu en GET). Aucune écriture nulle part.
// Lancer : ATG_COSTRUCTOR_CIBLE=olivier npx tsx --env-file=.env.local scripts/test-enrichir.mts
import {
  listerModelesCible,
  lireModeleExpand,
  deriverSectionsDepuisModele,
  type ProduitPlat,
  type PointSingulier,
} from '../lib/atg-devis-modele'
import { ajouterPointsSinguliers, enrichirDescriptions } from '../lib/enrichir-devis'
import type { SectionDevis } from '../lib/types'

const strip = (s: any) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
let p = 0, f = 0
const ck = (l: string, c: boolean) => { if (c) { p++; console.log('  ✅ ' + l) } else { f++; console.log('  ❌ ' + l) } }

// ---------- Couche 2 (pur, sans réseau) ----------
console.log('========== COUCHE 2 : ajout points singuliers (pur) ==========')
const produitsFake: ProduitPlat[] = [
  { id: 'p_souche', name: 'Reprise de souche de cheminée, enduit et étanchéité', unit: 'u', sellPrice: 25000 },
  { id: 'p_lavage', name: 'Lavage haute pression', unit: 'm2', sellPrice: 420 },
]
const pointsFake: PointSingulier[] = [
  { type: 'souche', libelle: 'souche de cheminée à reprendre', quantite: 1, unite: 'u' },
  { type: 'autre', libelle: 'objet totalement inexistant zzz', quantite: 1, unite: 'u' },
]
const base: SectionDevis[] = [
  { nom: 'Façade Sud', articles: [{ costructor_article_id: 'x1', libelle: 'Ravalement I3 taloché', unite: 'm²', prix_vente: 38, quantite: null, description_technique: '' }] },
]
const apres = ajouterPointsSinguliers(base, pointsFake, produitsFake)
const secPts = apres.find((s) => s.nom === 'Points singuliers')
ck('section "Points singuliers" ajoutée', !!secPts)
ck('souche (vrai produit) ajoutée', !!secPts?.articles.some((a) => a.costructor_article_id === 'p_souche'))
ck('point non résolu (zzz) ignoré', (secPts?.articles.length ?? 0) === 1)
ck('lavage (rôle exclu) non pris comme point', !secPts?.articles.some((a) => a.costructor_article_id === 'p_lavage'))
ck('prix converti centimes->euros (250€)', secPts?.articles[0]?.prix_vente === 250)
ck('aucun point => sections inchangées', ajouterPointsSinguliers(base, [], produitsFake) === base)

// ---------- Couche 1 (intégration Claude sur vrai modèle, GET) ----------
console.log('\n========== COUCHE 1 : descriptions adaptées (Claude, modèle réel) ==========')
const raw = await listerModelesCible()
const i3 = raw.find((m: any) => /i3 taloch/i.test(m.name ?? '') && (m.total ?? 0) > 0)
if (!i3) {
  console.log('  (modèle I3 taloché introuvable — skip couche 1)')
} else {
  const detail = await lireModeleExpand(i3.id)
  const sections = deriverSectionsDepuisModele(detail.lines ?? [], ['Façade Sud', 'Façade Nord'])
  const rapport =
    "Façade sud plein soleil, ancien enduit fortement fariné, deux fissures verticales au-dessus de la baie du séjour. " +
    "Façade nord très humide, mousses et traces de ruissellement. Ravalement I3 taloché sur les deux façades."
  const enrichies = await enrichirDescriptions(sections, rapport)
  // Au moins une description doit avoir changé et rester courte (style Olivier).
  let auMoinsUneAdaptee = false
  let toutesCourtes = true
  for (let si = 0; si < sections.length; si++) {
    for (let ai = 0; ai < sections[si].articles.length; ai++) {
      const avant = sections[si].articles[ai].description_technique
      const apres2 = enrichies[si].articles[ai].description_technique
      if (apres2 && apres2 !== avant) auMoinsUneAdaptee = true
      if ((apres2 ?? '').length > 320) toutesCourtes = false
    }
  }
  ck('descriptions adaptées (au moins une changée)', auMoinsUneAdaptee)
  ck('descriptions restent courtes (style Olivier)', toutesCourtes)
  ck('structure intacte (même nb de sections)', enrichies.length === sections.length)
  console.log('  --- aperçu ---')
  for (const s of enrichies.slice(0, 2)) {
    console.log(`  ▸ ${s.nom}`)
    for (const a of s.articles.slice(0, 2)) {
      console.log(`      • ${strip(a.libelle).slice(0, 42)}`)
      console.log(`        → ${strip(a.description_technique)}`)
    }
  }
}

console.log(`\nRECAP enrichissement : ${p} PASS | ${f} FAIL`)
if (f > 0) process.exit(1)
