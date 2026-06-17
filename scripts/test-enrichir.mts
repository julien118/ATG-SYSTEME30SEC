// Couche 2 = test PUR (faux produits). Couche 1 = intégration (Claude réel sur un
// vrai modèle d'Olivier lu en GET). Aucune écriture nulle part.
// Lancer : ATG_COSTRUCTOR_CIBLE=olivier npx tsx --env-file=.env.local scripts/test-enrichir.mts
import {
  listerModelesCible,
  lireModeleExpand,
  deriverSectionsDepuisModele,
  prefillerQuantites,
  type ProduitPlat,
  type PointSingulier,
  type MetresDevis,
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

// ---------- Couche 3 : pré-remplissage des quantités dictées (pur) ----------
console.log('\n========== COUCHE 3 : pré-remplissage des quantités (pur) ==========')
const sectionsQ: SectionDevis[] = [
  { nom: 'Façade Sud', articles: [
    { costructor_article_id: 'rav', libelle: 'Ravalement I3 finition talochée Virtuotech', unite: 'm²', prix_vente: 38, quantite: null, description_technique: '' },
    { costructor_article_id: 'app', libelle: 'Découpe des appuis de fenêtres', unite: 'ml', prix_vente: 20, quantite: null, description_technique: '' },
    { costructor_article_id: 'isonc', libelle: 'Isolation des murs partie non chauffée - Fourniture système Isolation Thermique Extérieur StarSystem', unite: 'm²', prix_vente: 130, quantite: null, description_technique: '' },
    { costructor_article_id: 'depl', libelle: 'Déplacements, installation du chantier', unite: 'u', prix_vente: 289, quantite: 1, description_technique: '' },
  ] },
  { nom: 'Elévation, lavage, traitement', articles: [
    { costructor_article_id: 'lav', libelle: 'Lavage haute pression', unite: 'm²', prix_vente: 4, quantite: null, description_technique: '' },
    { costructor_article_id: 'ech', libelle: 'Amené du matériel, montage échafaudage Comabi R200', unite: 'm²', prix_vente: 6, quantite: null, description_technique: '' },
  ] },
]
const metresQ: MetresDevis = {
  facades: [{ nom: 'Façade Sud', surface_m2: 45, appuis_ml: 6 }],
  transversal: { lavage_m2: 90, echafaudage_m2: 120 },
  points_singuliers: [],
}
const rempli = prefillerQuantites(sectionsQ, metresQ)
const art = (sec: string, id: string) =>
  rempli.find((s) => s.nom === sec)?.articles.find((a) => a.costructor_article_id === id)
ck('façade : ravalement = surface dictée (45)', art('Façade Sud', 'rav')?.quantite === 45)
ck('façade : appuis = mesure dictée (6)', art('Façade Sud', 'app')?.quantite === 6)
ck('façade : ITE non chauffée laissée vide (anti-doublon)', art('Façade Sud', 'isonc')?.quantite == null)
ck('forfait déplacement intact (1)', art('Façade Sud', 'depl')?.quantite === 1)
ck('transversal : lavage = dicté (90)', art('Elévation, lavage, traitement', 'lav')?.quantite === 90)
ck('transversal : échafaudage = dicté (120)', art('Elévation, lavage, traitement', 'ech')?.quantite === 120)

console.log(`\nRECAP enrichissement : ${p} PASS | ${f} FAIL`)
if (f > 0) process.exit(1)
