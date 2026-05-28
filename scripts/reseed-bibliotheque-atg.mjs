// =============================================================
// Re-seed de la bibliotheque de demo au STYLE OLIVIER (compte de JULIEN)
// =============================================================
// Source de verite : STYLE-OLIVIER.md (intitules verbatim + fourchettes prix).
// Compte cible : JULIEN uniquement (COSTRUCTOR_API_KEY_JULIEN || COSTRUCTOR_API_KEY).
// Aucune ecriture sur le compte d'Olivier.
//
// Ce que fait le script :
//   1. Vide la table Supabase bibliotheque_costructor (ancienne biblio generique).
//   2. Cree les 22 produits sur Costructor Julien (idempotent : reutilise un
//      produit existant de meme nom au lieu d'en recreer un).
//   3. Insere les 22 lignes dans bibliotheque_costructor (libelle VERBATIM Olivier).
//   4. Genere supabase/migrations/003_seed_bibliotheque_atg.sql (seed fige et rejouable).
//
// Lancement : node --env-file=.env.local scripts/reseed-bibliotheque-atg.mjs
// Les anciens produits Costructor (21) ne sont PAS supprimes : DELETE /products
// est refuse car ils sont utilises par d'anciens devis. Ils restent orphelins,
// hors bibliotheque, donc jamais proposes par la PWA.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const COST_BASE =
  process.env.COSTRUCTOR_API_BASE_URL || 'https://api.costructor.co/external/v1'
const COST_KEY = process.env.COSTRUCTOR_API_KEY_JULIEN || process.env.COSTRUCTOR_API_KEY
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!COST_KEY || !SUPA || !SR) {
  console.error('Variables manquantes (COSTRUCTOR_API_KEY[_JULIEN], NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).')
  process.exit(1)
}

const cH = { Authorization: `Bearer ${COST_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' }
const sH = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' }

// IDs d'unites Costructor (globaux, valides sur le compte Julien).
const UNIT = {
  'm²': 'unit_01fvj2wadbh7qc1784z1es0nke',
  ml: 'unit_01fvj2wafhw41w7hpaeb3ywfg5',
  u: 'unit_01fvj2wa9fgmx3th3na873ccws',
  'm³': 'unit_01fvj2wahmvbmnf8y0czmqjjep',
  ens: 'unit_01fvj2waghdkq11qjba76hk2dt',
}

// -------------------------------------------------------------
// Les 22 articles, intitules VERBATIM d'Olivier (cf. STYLE-OLIVIER.md).
// prix en EUROS (stocke tel quel en DB ; converti en centimes pour Costructor).
// -------------------------------------------------------------
const ARTICLES = [
  // --- Postes transversaux ---
  { libelle: "Déplacement, installation du chantier, mise en place matériel d'élévation, nettoyage de fin de chantier, repli", unite: 'u', prix: 549, mots: ['déplacement', 'installation', 'repli'] },
  { libelle: "Amené du matériel, montage échafaudage Comabi R200 Progress (conforme aux normes de montage en sécurité), repli du matériel", unite: 'm²', prix: 8.2, mots: ['échafaudage', 'comabi'] },
  { libelle: 'Lavage façade moyenne ou haute pression', unite: 'm²', prix: 3.8, mots: ['lavage'] },
  { libelle: 'Traitement algicide, fongicide, issu de la chimie raisonnée', unite: 'm²', prix: 3.9, mots: ['traitement', 'algicide', 'fongicide'] },
  { libelle: "Gestion des déchets : dépôt dans notre benne DIB, située 22 route de l'Aurore 37130 Mazières de Touraine, prestataire ETS Passenaud (compris traitement)", unite: 'm³', prix: 152.95, mots: ['déchets', 'benne'] },
  // --- Ravalement (finitions) ---
  { libelle: 'Ravalement I3 peinture HB Classification NF T 36-005 Famille I - classe 7b2-10c NF T 34-722 et DTU 42.1 : I1 à I4 selon système NF EN 1062-1 : E4à5V2W3A1à5 : après préparation du support, traitement des fissures à l\'enduit fibré : - application 1 couche de Virtuotech Fixateur opacifiant 200g/m2 - application 1 couche de Virtuotech Inter 300g/m2 - application 1 couche de Virtuotech lisse 400g/m2', unite: 'm²', prix: 33.07, mots: ['ravalement', 'i3', 'peinture'] },
  { libelle: "Ravalement I4 finition Talochée HB Classification NF T 36-005 Famille I - classe 7b2-10c NF T 34-722 et DTU 42.1 : I1 à I4 selon système NF EN 1062-1 : E4à5V2W3A1à5 : après préparation du support, traitement des fissures à l'enduit fibré : - application 1 couche de Virtuotech Fixateur opacifiant 200g/m2 - application 1 couche de Virtuotech Inter 300g/m2 avec marouflage d'une toile antifissure - application 1 couche de Virtuotech Inter 300g/m2 - application 1 couche de Virtuotech taloché grains fins 1.4kg/m2 Compris création d'une plinthe anti remontée capillaire de 20cm de haut, conforme au DTU, application 2 couches de Virtuolite (D2)", unite: 'm²', prix: 59.35, mots: ['ravalement', 'i4', 'taloché'] },
  { libelle: "Façade : après préparation du support, traitement des fissures, fourniture et mise en oeuvre système de ravalement d'étanchéité type I4 avec entoilage", unite: 'm²', prix: 59.8, mots: ['ravalement', 'i4', 'entoilage'] },
  { libelle: "Système de ravalement d'imperméabilisation I3 10/10e épaisseur du système > 0.4mm selon classement norme NF P 84-403", unite: 'm²', prix: 49.9, mots: ['ravalement', 'imperméabilisation', 'i3'] },
  { libelle: 'Mur intérieur : après préparation du support, fourniture et mise en oeuvre système de ravalement d\'étanchéité type I3 taloché conforme norme NF P 84403 et NF EN1062-1', unite: 'm²', prix: 58.8, mots: ['ravalement', 'i3', 'taloché', 'mur'] },
  // --- ITE ---
  { libelle: "Fourniture et mise en oeuvre système d'Isolation Thermique Extérieur Système BAUMIT STARSYSTEM : calé, chevillé, compris rails de départ, accessoires de renforts d'angles, mousse de remplissage, arrêts latéraux et hauts, armature générale", unite: 'm²', prix: 149.8, mots: ['ite', 'isolation', 'baumit', 'starsystem'] },
  { libelle: 'Baumit ProTherm PSE BLANC épaisseur 140 mm R= 3.70 , ACERMI 12/081/793', unite: 'm²', prix: 21.7, mots: ['pse', 'isolant', 'baumit'] },
  { libelle: 'PSE GRIS TH31 EPAIS. 140MM R=4.50 ACERMI N°17/201/1197 édition 6', unite: 'm²', prix: 21.62, mots: ['pse', 'isolant'] },
  { libelle: 'Isolation soubassement : fourniture et mise en oeuvre collée sur soubassements panneaux de Polystyrène type PS 30 SE 120MM, compris colle type Flexyl, enduit de base + treillis d\'armature, finition peinture microporeuse Virtuolite 2 couches', unite: 'ml', prix: 138, mots: ['soubassement', 'isolation'] },
  // --- Points singuliers, appuis, finitions ---
  { libelle: 'Découpe des appuis de fenêtres (compris mise à la benne des gravats) raccords polystyrène, pose appui de fenêtre isolant', unite: 'ml', prix: 105.5, mots: ['appui', 'découpe'] },
  { libelle: 'mise en peinture des appuis de fenêtres, après préparation du support, application 2 couches Sigmasol', unite: 'ml', prix: 34.05, mots: ['appui', 'peinture'] },
  { libelle: 'Appui MSEA 1100MM PROF 390MM', unite: 'u', prix: 149.27, mots: ['appui', 'msea'] },
  { libelle: 'Corniches : préparation du support, application 2 couches de peinture décorative (D2)', unite: 'ml', prix: 19.3, mots: ['corniche'] },
  { libelle: 'Dessous de toit (angle) grattage des parties mal adhérentes, nettoyage, ponçage, essuyage, application 2 couches de laque', unite: 'ml', prix: 38.5, mots: ['dessous de toit'] },
  { libelle: 'Souche de cheminée : fourniture et mise en place matériel d\'élévation, préparation du support, application 2 couches de peinture décorative (D2) teinte façade', unite: 'u', prix: 189, mots: ['souche', 'cheminée'] },
  { libelle: "Descente d'eau pluviale, après préparation, application 2 couches de finition teinte façade", unite: 'ml', prix: 12.8, mots: ['descente', 'eau pluviale'] },
  { libelle: 'Fourniture et pose de fixation pour descente EP, arrêt de volet, goulotte, charge légère...', unite: 'u', prix: 15.9, mots: ['fixation', 'descente'] },
]

const eurosVersCentimes = (e) => Math.round(e * 100)
const sqlEscape = (s) => String(s).replace(/'/g, "''")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// POST Costructor avec retry sur 429 (rate limit) en backoff exponentiel.
async function postProduit(body) {
  let delai = 800
  for (let essai = 1; essai <= 6; essai++) {
    const r = await fetch(`${COST_BASE}/products`, { method: 'POST', headers: cH, body: JSON.stringify(body) })
    if (r.status !== 429) return r
    console.log(`      (429 rate limit, attente ${delai}ms, essai ${essai}/6)`)
    await sleep(delai)
    delai *= 2
  }
  throw new Error('Rate limit persistant apres 6 essais')
}

async function main() {
  console.log('=============================================================')
  console.log('Re-seed bibliotheque demo au style Olivier — compte JULIEN')
  console.log(`Costructor key tail : ${COST_KEY.slice(-6)} | ${ARTICLES.length} articles`)
  console.log('=============================================================\n')

  // 1) Vider la table Supabase.
  console.log('[1] Vidage de bibliotheque_costructor')
  const del = await fetch(`${SUPA}/rest/v1/bibliotheque_costructor?costructor_article_id=not.is.null`, {
    method: 'DELETE',
    headers: { ...sH, Prefer: 'return=minimal' },
  })
  console.log(`    -> HTTP ${del.status}`)
  if (!del.ok && del.status !== 404) {
    console.error('    Echec vidage :', (await del.text()).slice(0, 200))
    process.exit(1)
  }

  // 2) Carte des produits Costructor existants (pour idempotence par nom).
  const rp = await fetch(`${COST_BASE}/products?_limit=1000`, { headers: cH })
  const jp = await rp.json()
  const existants = (Array.isArray(jp) ? jp : jp.data || [])
  const parNom = new Map()
  for (const p of existants) {
    const nom = String(p.name || '').replace(/<[^>]+>/g, '').trim()
    if (!parNom.has(nom)) parNom.set(nom, p.id)
  }

  // 3) Cree (ou reutilise) chaque produit, puis prepare les lignes DB.
  console.log('\n[2] Creation des produits Costructor (idempotent par nom)')
  const lignes = []
  for (const a of ARTICLES) {
    const unitId = UNIT[a.unite]
    if (!unitId) throw new Error(`Unite inconnue : ${a.unite}`)
    let id = parNom.get(a.libelle)
    if (id) {
      console.log(`    = reutilise ${id} | ${a.libelle.slice(0, 50)}`)
    } else {
      const r = await postProduit({ name: a.libelle, unit: unitId, sellPrice: eurosVersCentimes(a.prix) })
      if (!r.ok) {
        console.error(`    ! echec POST produit : ${a.libelle.slice(0, 40)} -> ${r.status} ${(await r.text()).slice(0, 150)}`)
        process.exit(1)
      }
      const j = await r.json()
      id = (j.data || j).id
      console.log(`    + cree ${id} | ${a.unite.padEnd(3)} ${a.prix}€ | ${a.libelle.slice(0, 45)}`)
      await sleep(300) // throttle pour eviter le 429
    }
    lignes.push({ costructor_article_id: id, libelle: a.libelle, unite: a.unite, prix_vente: a.prix, mots_cles: a.mots })
  }

  // 4) Insertion en base.
  console.log('\n[3] Insertion dans bibliotheque_costructor')
  const ins = await fetch(`${SUPA}/rest/v1/bibliotheque_costructor`, {
    method: 'POST',
    headers: { ...sH, Prefer: 'return=minimal' },
    body: JSON.stringify(lignes),
  })
  console.log(`    -> HTTP ${ins.status}`)
  if (!ins.ok) {
    console.error('    Echec insertion :', (await ins.text()).slice(0, 300))
    process.exit(1)
  }

  // 5) Generation du seed SQL fige.
  console.log('\n[4] Generation de supabase/migrations/003_seed_bibliotheque_atg.sql')
  const valeurs = lignes
    .map((l) => {
      const mots = l.mots_cles.map((m) => `'${sqlEscape(m)}'`).join(', ')
      return `  ('${l.costructor_article_id}', '${sqlEscape(l.libelle)}', '${l.unite}', ${l.prix_vente}, ARRAY[${mots}]::text[])`
    })
    .join(',\n')
  const sql = `-- =============================================================
-- 003_seed_bibliotheque_atg.sql
-- Seed de la bibliotheque de demo au STYLE OLIVIER (compte Costructor de JULIEN).
-- Genere par scripts/reseed-bibliotheque-atg.mjs le ${new Date().toISOString().slice(0, 10)}.
-- Intitules repris VERBATIM des vrais devis d'Olivier (cf. STYLE-OLIVIER.md).
--
-- ATTENTION : les costructor_article_id ci-dessous pointent vers les produits
-- du compte de JULIEN. Sur un autre compte Costructor, recreer les produits et
-- regenerer ce fichier via le script. Idempotent : rejouable (DELETE puis INSERT).
-- =============================================================

DELETE FROM bibliotheque_costructor;

INSERT INTO bibliotheque_costructor (costructor_article_id, libelle, unite, prix_vente, mots_cles) VALUES
${valeurs};
`
  const chemin = join(process.cwd(), 'supabase', 'migrations', '003_seed_bibliotheque_atg.sql')
  writeFileSync(chemin, sql, 'utf8')
  console.log(`    -> ecrit (${lignes.length} articles)`)

  console.log('\n==> Re-seed termine. Bibliotheque = ' + lignes.length + ' articles style Olivier.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
