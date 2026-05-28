// =============================================================
// Scenario de demo FIGE — M. et Mme Dupont, 3 facades (compte JULIEN)
// =============================================================
// Reconstruit le scenario de reference Dupont avec les NOUVEAUX articles style
// Olivier (cf. bibliotheque_costructor re-seedee) et FIGE le total de la demo.
// Seed un chantier "M. et Mme Dupont" + 3 observations vocales + un devis dont
// les sections_finales et les totaux sont stables (ne dependent pas d'une
// generation IA live, donc le chiffre ne bouge pas la veille de la demo).
//
// Idempotent : rejouable (reutilise le chantier Dupont, remplace ses captures
// et son devis).
//
// TOTAL CIBLE FIGE (2026-05-28) : 6 806,68 EUR HT / 7 487,35 EUR TTC (TVA 10%).
// Pour changer le total, ajuster les quantites dans la section "sections" ci-dessous.
//
// Lancement : node --env-file=.env.local scripts/scenario-dupont.mjs

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPA || !SR) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquantes.')
  process.exit(1)
}
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' }

const CLIENT = 'M. et Mme Dupont'
const ADRESSE = '12 rue des Lilas, 37130 Cinq-Mars-la-Pile'

async function rest(method, path, body, prefer) {
  const headers = { ...H }
  if (prefer) headers.Prefer = prefer
  const r = await fetch(`${SUPA}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const txt = await r.text()
  let json
  try { json = txt ? JSON.parse(txt) : null } catch { json = txt }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${txt.slice(0, 200)}`)
  return json
}

async function main() {
  console.log('=============================================================')
  console.log('Scenario demo Dupont (3 facades) — figeage du total')
  console.log('=============================================================\n')

  // 1) Recupere la bibliotheque re-seedee et resout les articles par mot-cle.
  const biblio = await rest('GET', 'bibliotheque_costructor?select=costructor_article_id,libelle,unite,prix_vente')
  const art = (needle) => {
    const n = needle.toLowerCase()
    const found = biblio.find((b) => b.libelle.toLowerCase().includes(n))
    if (!found) throw new Error(`Article introuvable en bibliotheque : "${needle}"`)
    return found
  }
  const A = {
    deplacement: art('déplacement, installation'),
    echafaudage: art('montage échafaudage comabi'),
    lavage: art('lavage façade moyenne'),
    traitement: art('traitement algicide'),
    ravI3: art('ravalement i3 peinture hb'),
    facadeI4: art('type i4 avec entoilage'),
  }

  // Petit helper de ligne (quantite + description courte style Olivier).
  const ligne = (a, quantite, description) => ({
    costructor_article_id: a.costructor_article_id,
    libelle: a.libelle,
    unite: a.unite,
    prix_vente: a.prix_vente,
    quantite,
    description_technique: description,
  })

  // 2) Scenario : 3 facades + moyens generaux. Quantites realistes (pavillon).
  const sections = [
    {
      nom: 'MOYENS GÉNÉRAUX',
      articles: [
        ligne(A.deplacement, 1, "Installation du chantier, matériel d'élévation, nettoyage et repli en fin de travaux."),
        ligne(A.echafaudage, 115, 'Échafaudage Comabi R200 sur les trois façades, montage conforme NF, protections et repli compris.'),
      ],
    },
    {
      nom: 'FAÇADE SUD',
      articles: [
        ligne(A.lavage, 42, 'Façade Sud plein soleil, salissures et farinage. Lavage moyenne pression avant traitement.'),
        ligne(A.traitement, 42, 'Traitement algicide fongicide de la façade Sud avant mise en peinture, chimie raisonnée.'),
        ligne(A.ravI3, 42, 'Façade Sud, fissures en escalier en partie haute. Ravalement I3 Virtuotech après enduit fibré, teinte façade.'),
      ],
    },
    {
      nom: 'FAÇADE NORD',
      articles: [
        ligne(A.lavage, 42, 'Façade Nord ombragée, mousses en partie basse. Lavage moyenne pression avant traitement.'),
        ligne(A.traitement, 42, 'Traitement algicide fongicide de la façade Nord, élimination des mousses, chimie raisonnée.'),
        ligne(A.ravI3, 42, 'Façade Nord saine. Ravalement I3 Virtuotech après préparation du support, finition teinte façade.'),
      ],
    },
    {
      nom: 'PIGNON EST',
      articles: [
        ligne(A.lavage, 28, 'Pignon Est exposé aux pluies battantes. Lavage haute pression avant traitement des fissures.'),
        ligne(A.traitement, 28, 'Traitement algicide fongicide du pignon Est avant imperméabilisation, chimie raisonnée.'),
        ligne(A.facadeI4, 28, 'Pignon Est, fissures actives sur toute la hauteur. Imperméabilisation I4 avec entoilage et marouflage.'),
      ],
    },
  ]

  // 3) Totaux. HT = somme(quantite x prix_vente). TTC = HT x 1.10 (TVA travaux 10%).
  let totalHT = 0
  console.log('Detail du devis :')
  for (const s of sections) {
    console.log(`\n  [${s.nom}]`)
    for (const a of s.articles) {
      const sousTotal = a.quantite * a.prix_vente
      totalHT += sousTotal
      console.log(`    ${String(a.quantite).padStart(4)} ${a.unite.padEnd(3)} x ${String(a.prix_vente).padStart(7)} = ${sousTotal.toFixed(2).padStart(9)}  ${a.libelle.slice(0, 42)}`)
    }
  }
  totalHT = Math.round(totalHT * 100) / 100
  const totalTTC = Math.round(totalHT * 1.1 * 100) / 100
  console.log('\n-------------------------------------------------------------')
  console.log(`  TOTAL HT  : ${totalHT.toFixed(2)} €`)
  console.log(`  TVA 10%   : ${(totalTTC - totalHT).toFixed(2)} €`)
  console.log(`  TOTAL TTC : ${totalTTC.toFixed(2)} €`)
  console.log('-------------------------------------------------------------\n')

  // 4) Upsert chantier Dupont (idempotent par client_nom).
  const userId = (await rest('GET', 'chantiers?select=user_id&limit=1'))[0]?.user_id
  if (!userId) throw new Error('Impossible de recuperer un user_id existant.')

  const existant = await rest('GET', `chantiers?select=id&client_nom=eq.${encodeURIComponent(CLIENT)}`)
  let chantierId
  const champsChantier = {
    user_id: userId,
    client_nom: CLIENT,
    client_adresse: ADRESSE,
    date_visite: '2026-05-26',
    objet_travaux: 'Ravalement de façade I3 et imperméabilisation I4, 3 façades',
    statut: 'rapport_genere',
  }
  if (existant.length) {
    chantierId = existant[0].id
    await rest('PATCH', `chantiers?id=eq.${chantierId}`, champsChantier, 'return=minimal')
    console.log(`[chantier] reutilise ${chantierId}`)
  } else {
    const cree = await rest('POST', 'chantiers', champsChantier, 'return=representation')
    chantierId = cree[0].id
    console.log(`[chantier] cree ${chantierId}`)
  }

  // 5) Remplace les captures vocales (3 observations facade par facade).
  await rest('DELETE', `capture_items?chantier_id=eq.${chantierId}`, null, 'return=minimal')
  const vocaux = [
    'Façade sud, façade exposée plein soleil, support en bon état général, quelques fissures en escalier sur la partie haute, on part sur un ravalement I3.',
    'Façade nord, façade saine, pas de dégradation visible, juste un peu de mousse sur le bas, lavage puis ravalement I3.',
    'Pignon Est, fissures actives sur toute la hauteur, on traite en imperméabilité I4 avec entoilage.',
  ]
  await rest('POST', 'capture_items', vocaux.map((t, i) => ({
    chantier_id: chantierId, type: 'vocal', position: i, transcription: t,
  })), 'return=minimal')
  console.log(`[captures] ${vocaux.length} observations vocales`)

  // 6) Remplace le devis (sections figees + totaux figes).
  await rest('DELETE', `devis?chantier_id=eq.${chantierId}`, null, 'return=minimal')
  await rest('POST', 'devis', {
    chantier_id: chantierId,
    statut: 'metres_en_cours',
    sections_proposees: sections,
    sections_finales: sections,
    total_ht: totalHT,
    total_ttc: totalTTC,
  }, 'return=minimal')
  console.log(`[devis] sections_finales + totaux figes (HT ${totalHT} / TTC ${totalTTC})`)

  console.log(`\n==> Scenario Dupont fige. Chantier ${chantierId}.`)
  console.log(`    Recap : /chantiers/${chantierId}/devis/recap`)
}

main().catch((e) => { console.error(e); process.exit(1) })
