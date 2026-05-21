// Test du refactor structure ATG de `construirePayloadDevis`.
// Reproduit le scénario de référence (M. et Mme Dupont, 3 façades) défini dans
// le brief projet et vérifie :
//   - total HT = 4 917 €
//   - total TTC = 5 408,70 €
//   - les sections transversales ATG (Lavage, Traitement) captent les bons
//     articles et la somme des produits du payload reste à 4 917 €
//   - l'ordre des sections dans le payload respecte la structure ATG
//
// Lancer : npx tsx --env-file=.env.local scripts/test-devis-structure-atg.mts

import {
  calculerTotalHT,
  calculerTotalTTC,
  construirePayloadDevis,
} from '../lib/costructor'
import type { SectionDevis } from '../lib/types'

// Scénario de référence du brief : M. et Mme Dupont, 12 rue des Lilas,
// 37130 Cinq-Mars-la-Pile, 3 façades.
// IDs Costructor fictifs pour le test (la fonction n'a besoin que d'un string).
const scenarioDupont: SectionDevis[] = [
  {
    nom: 'FAÇADE SUD',
    articles: [
      { costructor_article_id: 'prod_prep_hp', libelle: 'Préparation support haute pression', unite: 'm²', prix_vente: 8, quantite: 45, description_technique: 'Lavage façade Sud.' },
      { costructor_article_id: 'prod_trait_fiss', libelle: 'Traitement fissures en escalier', unite: 'ml', prix_vente: 25, quantite: 12, description_technique: 'Ouverture + rebouchage fissures Sud.' },
      { costructor_article_id: 'prod_entoilage', libelle: 'Entoilage partiel sur fissures', unite: 'ml', prix_vente: 18, quantite: 8, description_technique: 'Calicot polyester sur fissures Sud.' },
      { costructor_article_id: 'prod_i3_taloche', libelle: 'Ravalement façade système I3 taloché', unite: 'm²', prix_vente: 45, quantite: 45, description_technique: 'Finition I3 taloché Sud.' },
    ],
  },
  {
    nom: 'FAÇADE NORD',
    articles: [
      { costructor_article_id: 'prod_prep_hp', libelle: 'Préparation support haute pression', unite: 'm²', prix_vente: 8, quantite: 38, description_technique: 'Lavage façade Nord.' },
      { costructor_article_id: 'prod_peint_deco', libelle: 'Peinture décorative 2 couches garantie 5 ans', unite: 'm²', prix_vente: 28, quantite: 38, description_technique: 'Finition peinture Nord.' },
    ],
  },
  {
    nom: 'PIGNON EST',
    articles: [
      { costructor_article_id: 'prod_trait_fiss', libelle: 'Traitement fissures en escalier', unite: 'ml', prix_vente: 25, quantite: 6, description_technique: 'Fissures Pignon Est.' },
      { costructor_article_id: 'prod_imper_i3', libelle: 'Imperméabilité I3 finition peinture', unite: 'm²', prix_vente: 38, quantite: 15, description_technique: 'I3 Pignon Est.' },
    ],
  },
]

function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) console.log(`✅ ${label}`)
  else console.log(`❌ ${label}${detail ? `\n   ${detail}` : ''}`)
}

// ---- 1) Total HT/TTC brut ----
const totalHT = calculerTotalHT(scenarioDupont)
const totalTTC = calculerTotalTTC(totalHT)

console.log(`\nTotal HT calculé : ${totalHT} €`)
console.log(`Total TTC calculé : ${totalTTC} €\n`)

assert(totalHT === 4917, 'Total HT = 4 917 €', `obtenu : ${totalHT}`)
assert(totalTTC === 5408.7, 'Total TTC = 5 408,70 €', `obtenu : ${totalTTC}`)

// ---- 2) Construction du payload Costructor ----
const payload = construirePayloadDevis({
  contactId: 'cnt_test_dupont',
  sections: scenarioDupont,
  description: 'Test scénario référence Dupont.',
})

// La somme des lignes produits doit faire 4 917 € (en centimes : 491 700).
const totalCentimes = payload.lines.reduce((s, l) => {
  return l.type === 'product' ? s + l.sellPrice * l.quantity : s
}, 0)
assert(
  totalCentimes === 491700,
  'Somme des sellPrice × quantity du payload = 491 700 c (4 917 €)',
  `obtenu : ${totalCentimes} centimes`,
)

// ---- 3) Vérifier l'ordre des sections dans le payload ----
const titresEmis = payload.lines
  .filter((l) => l.type === 'text')
  .map((l) => l.description.replace(/<[^>]+>/g, '').replace(/•.*$/s, '').trim())

console.log(`\nOrdre des sections émises :`)
titresEmis.forEach((t, i) => console.log(`  ${i + 1}. ${t}`))

assert(
  titresEmis[0]?.startsWith('QUALIFICATIONS ATG'),
  '1ère ligne text = QUALIFICATIONS ATG (en-tête)',
)
assert(
  titresEmis[1] === 'POSTE DÉPLACEMENT' &&
    titresEmis[2] === 'ÉCHAFAUDAGE' &&
    titresEmis[3] === 'LAVAGE' &&
    titresEmis[4] === 'TRAITEMENT',
  'Sections transversales dans l\'ordre : Déplacement → Échafaudage → Lavage → Traitement',
  `obtenus : ${titresEmis.slice(1, 5).join(' → ')}`,
)
const facadesEmises = titresEmis.slice(5)
assert(
  facadesEmises.includes('FAÇADE SUD') && facadesEmises.includes('FAÇADE NORD'),
  'Façades Sud et Nord présentes (articles restants après extraction)',
  `obtenus : ${facadesEmises.join(', ')}`,
)
assert(
  !facadesEmises.includes('PIGNON EST'),
  'PIGNON EST absent (tous ses articles ont été captés par TRAITEMENT)',
  `obtenus : ${facadesEmises.join(', ')}`,
)

// ---- 4) Vérifier le contenu de LAVAGE et TRAITEMENT ----
// On scanne le payload : entre le titre LAVAGE et le titre suivant, on s'attend
// à 2 articles "Préparation support haute pression" (Sud 45m² + Nord 38m²).
function articlesEntreTitres(payload: typeof payload, titre: string): Array<{ libelle: string; quantity: number }> {
  const lignes = payload.lines
  const start = lignes.findIndex(
    (l) => l.type === 'text' && l.description.includes(titre),
  )
  if (start < 0) return []
  const articles: Array<{ libelle: string; quantity: number }> = []
  for (let i = start + 1; i < lignes.length; i++) {
    const l = lignes[i]
    if (l.type === 'text') break
    const libelle = l.description.replace(/<[^>]+>/g, '').split('•')[0].trim()
    articles.push({ libelle, quantity: l.quantity })
  }
  return articles
}

const articlesLavage = articlesEntreTitres(payload, 'LAVAGE')
const articlesTraitement = articlesEntreTitres(payload, 'TRAITEMENT')

console.log(`\nLAVAGE → ${articlesLavage.length} article(s) : ${articlesLavage.map((a) => `${a.libelle} (${a.quantity})`).join(', ')}`)
console.log(`TRAITEMENT → ${articlesTraitement.length} article(s) : ${articlesTraitement.map((a) => `${a.libelle} (${a.quantity})`).join(', ')}`)

assert(
  articlesLavage.length === 2 && articlesLavage.every((a) => a.libelle.startsWith('Préparation support haute pression')),
  'LAVAGE contient les 2 Préparation HP (Sud 45 + Nord 38)',
)
assert(
  articlesTraitement.length === 4,
  'TRAITEMENT contient 4 articles (Trait fiss Sud + Entoilage Sud + Trait fiss Pignon + Imper I3 Pignon)',
  `obtenu : ${articlesTraitement.length}`,
)
