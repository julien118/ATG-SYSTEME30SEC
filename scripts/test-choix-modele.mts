// Test PUR (aucun réseau) de la sélection de modèle choisirModele : on vérifie
// que l'objet des travaux (ce qu'Olivier tape) tombe sur le bon modèle, robuste
// aux variantes proches. À lancer : npx tsx scripts/test-choix-modele.mts
import { choisirModele, type ModeleDevis } from '../lib/atg-routing'

// Jeu de modèles factices imitant les vrais d'Olivier (noms + descriptions réels).
const MODELES: ModeleDevis[] = [
  { id: 'm_ite', name: 'ITE 03.2026', description: "Travaux d'Isolation Thermique par l'Extérieur, garantie décennale", total: 420192, model: true },
  { id: 'm_iso', name: "Isolation thermique par l'extérieur", description: '', total: 345703, model: true },
  { id: 'm_i3t', name: 'Ravalement I3 taloché', description: 'Travaux de ravalement de façade finition I3 taloché, garantie décennale', total: 1044653, model: true },
  { id: 'm_i4t', name: 'Ravalement I4 taloché 06.2026', description: 'Travaux de ravalement de façade type I4 taloché, garantie décennale', total: 149797, model: true },
  { id: 'm_i3p', name: 'I3 peinture 06.2026', description: 'Ravalement de façade, finition I3 peinture, garantie décennale', total: 130404, model: true },
  { id: 'm_vide1', name: 'Modèle sans titre', description: '', total: 0, model: true }, // stub -> exclu
  { id: 'm_vide2', name: 'Ravalement I3 peinture', description: '', total: 0, model: true }, // stub -> exclu
  { id: 'm_pasmodele', name: 'Un vrai devis client', description: 'ITE chez M. Martin', total: 9999, model: false }, // pas un modèle
]

let pass = 0
let fail = 0
function check(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

// 1) Chaque type tombe sur le bon modèle.
check('I3 taloché -> m_i3t', choisirModele('Ravalement I3 taloché', MODELES).modeleId === 'm_i3t')
check('I4 taloché -> m_i4t', choisirModele('Ravalement I4 taloché', MODELES).modeleId === 'm_i4t')
check('I3 peinture -> m_i3p', choisirModele('I3 peinture', MODELES).modeleId === 'm_i3p')
const ite = choisirModele('ITE isolation thermique par l\'extérieur', MODELES)
check('ITE -> un modèle ITE (m_ite ou m_iso)', ite.modeleId === 'm_ite' || ite.modeleId === 'm_iso')

// 2) Discrimination des variantes proches : I3 taloché ne doit PAS gagner sur I3 peinture, et vice versa.
check('I3 taloché bat I3 peinture', (() => { const c = choisirModele('ravalement i3 taloché', MODELES); return c.modeleId === 'm_i3t' })())
check('I3 peinture bat I3 taloché', (() => { const c = choisirModele('ravalement i3 peinture virtuotech', MODELES); return c.modeleId === 'm_i3p' })())

// 3) Type inconnu -> aucun modèle (repli IA).
check('type inconnu -> aucun', choisirModele('rénovation cuisine et plomberie', MODELES).modeleId === null)

// 4) Liste exposée : seulement les modèles réels (model:true && total>0), pas les stubs ni les non-modèles.
const dispo = choisirModele('', MODELES).modelesDisponibles
check('liste = 5 modèles réels (stubs + non-modèle exclus)', dispo.length === 5)
check('stub vide exclu de la liste', !dispo.some((m) => m.id === 'm_vide1' || m.id === 'm_vide2'))
check('non-modèle (model:false) exclu', !dispo.some((m) => m.id === 'm_pasmodele'))

console.log(`\nRECAP choisirModele : ${pass} PASS | ${fail} FAIL`)
if (fail > 0) process.exit(1)
