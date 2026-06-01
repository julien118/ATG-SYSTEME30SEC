// =============================================================
// Phase H (corrections) : fidelite TVA + idempotence du devis (compte test)
// =============================================================
// PARTIE A - TVA : un devis genere recopie ligne par ligne le taux de TVA de son
//   modele (aucun taux force). On compare la distribution des taux devis vs
//   modele. NB : le compte test de Julien est NON ASSUJETTI, donc taxable=false
//   et taxTotal=0 au niveau devis ; la fidelite se mesure LIGNE PAR LIGNE (taux
//   recopie) et la TVA s'agregera sur le compte assujetti d'Olivier en prod.
// PARTIE B - IDEMPOTENCE : un re-push pour le meme chantier remplace l'ancien
//   brouillon au lieu d'accumuler (avant : 2 brouillons ; apres : 1).
//
// Ecritures sur le compte test de Julien uniquement (assertCompteJulien). DELETE
// autorise sur le compte test. Aucune ecriture chez Olivier. Contacts synthetiques.
//
// Lancer : npx tsx --env-file=.env.local scripts/test-phase-h-tva-idempotence.mts

import { readFileSync } from 'node:fs'
import { selectionnerModele, type ModeleDevis } from '../lib/atg-routing'
import {
  assertCompteJulien,
  bannerCompte,
  construirePayloadDepuisModele,
  extraireMetres,
  getModeleExpand,
  listerModeles,
  listerProduitsPlats,
  pousserDevisGroupe,
  type LignePayload,
} from '../lib/atg-devis-modele'
import { persistRapportPdf, recupererUrlRapportPdf } from '../lib/rapport-pdf'

const CHANTIER_CR = 'f0ff75dc-b2f6-4034-95b3-d6c417c84456' // Residence Charles Daquin (a un CR)
const BASE = process.env.COSTRUCTOR_API_BASE_URL || 'https://api.costructor.co/external/v1'
const KEY = assertCompteJulien()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let total = 0, echecs = 0
const ok = (c: boolean, label: string, detail = '') => {
  total++; if (!c) echecs++
  console.log(`${c ? '✅' : '❌'} ${label}${detail ? `  (${detail})` : ''}`)
}

// Appel HTTP unique avec retry sur 429 et parse JSON defensif (corps vide toleré).
async function req(method: string, path: string, body?: any): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${KEY}`, Accept: 'application/json' }
  if (body) headers['Content-Type'] = 'application/json'
  for (let i = 0; i < 7; i++) {
    const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
    if (r.status === 429) { await sleep(1200 * (i + 1)); continue }
    const txt = await r.text()
    let j: any = null
    try { j = txt ? JSON.parse(txt) : null } catch { j = null }
    return { status: r.status, body: j }
  }
  return { status: 429, body: null }
}
const rawPost = (body: any) => req('POST', '/quotes', body)
async function getStatus(id: string): Promise<number> {
  return (await req('GET', `/quotes/${id}`)).status
}
async function del(id: string): Promise<number> {
  return (await req('DELETE', `/quotes/${id}`)).status
}
// Brouillons VIVANTS (model:false, non supprimes) dont la description reference
// ce chantier (via le lien CR). Costructor fait du soft-delete : un devis
// supprime reste dans la liste avec deletedAt/status='deleted' (GET=404), on
// l'exclut donc explicitement du comptage.
async function brouillonsReferencant(chantierId: string): Promise<string[]> {
  const r = await req('GET', '/quotes?_limit=1000')
  const arr = (r.body?.data ?? r.body ?? []) as any[]
  return arr
    .filter((q) => !q.model && !q.deletedAt && q.status !== 'deleted')
    .filter((q) => (q.description ?? '').includes(chantierId))
    .map((q) => q.id)
}

// Distribution des taux de TVA (points de base) sur les lignes produit d'un arbre.
function distributionTaux(lines: any[]): Map<number, number> {
  const d = new Map<number, number>()
  const walk = (ls: any[]) => {
    for (const l of ls ?? []) {
      if (l.type === 'product') {
        const t = l.taxRate ?? 0
        d.set(t, (d.get(t) ?? 0) + 1)
      }
      if (l.type === 'group') walk(l.lines)
    }
  }
  walk(lines)
  return d
}
const fmtDist = (d: Map<number, number>) =>
  Array.from(d.entries()).sort((a, b) => a[0] - b[0]).map(([t, n]) => `${n}x${(t / 100).toFixed(1)}%`).join(' ')

// Compte les lignes produit (recursif) d'un payload, et celles portant une taxe.
function compterTaxePayload(lines: LignePayload[]): { produits: number; avecTaxe: number } {
  let produits = 0, avecTaxe = 0
  const walk = (ls: LignePayload[]) => {
    for (const l of ls) {
      if (l.type === 'product') { produits++; if (l.tax || l.taxRate) avecTaxe++ }
      else if (l.type === 'group') walk(l.lines)
    }
  }
  walk(lines)
  return { produits, avecTaxe }
}

async function main() {
  console.log('\n########  PHASE H - FIDELITE TVA + IDEMPOTENCE  ########\n')
  bannerCompte('LECTURE')
  const keyOlivier = process.env.COSTRUCTOR_API_KEY_OLIVIER
  ok(!keyOlivier || KEY !== keyOlivier, 'GARDE-FOU : cle d\'ecriture != cle Olivier')

  // ---------- PARTIE A : FIDELITE TVA ----------
  console.log('\n========== PARTIE A : FIDELITE TVA (ligne par ligne) ==========')
  const DICTEE = `Ravalement I3 peinture rue des Tilleuls, deux facades.
Facade Sud 60 metres carres, dessous de toit 12 metres, appuis 8 metres.
Facade Nord 40 metres carres, dessous de toit 12 metres.
Echafaudage 100 metres carres, lavage et traitement.`

  const modelesRaw = await listerModeles()
  const modeles: ModeleDevis[] = modelesRaw.map((m: any) => ({
    id: m.id, name: m.name ?? null, description: m.description ?? null, total: m.total ?? null, model: !!m.model,
  }))
  const routage = selectionnerModele(DICTEE, modeles)
  console.log(`Routage : ${routage.typologie} (${routage.confiance}) -> ${routage.modeleId}`)
  ok(routage.typologie === 'ravalement_i3_peinture', 'Typologie = ravalement_i3_peinture')
  if (!routage.modeleId) throw new Error('Pas de modele.')

  const modele = await getModeleExpand(routage.modeleId)
  const distModele = distributionTaux(modele.lines)
  console.log(`TVA du MODELE source : ${fmtDist(distModele)} | taxable=${modele.taxable} taxTotal=${modele.taxTotal}`)
  ok(Array.from(distModele.keys()).some((t) => t > 0), 'Le modele porte une TVA ligne par ligne (apres re-replication)')

  const produits = await listerProduitsPlats()
  const metres = await extraireMetres(DICTEE)
  const construit = construirePayloadDepuisModele(modele.lines, metres, produits)
  const cptPayload = compterTaxePayload(construit.lines)
  ok(cptPayload.avecTaxe === cptPayload.produits, 'Toutes les lignes produit du payload portent une taxe', `${cptPayload.avecTaxe}/${cptPayload.produits}`)

  // Push (chantier avec CR) via le chemin idempotent.
  await persistRapportPdf(CHANTIER_CR) // s'assure que le CR existe
  const map = JSON.parse(readFileSync('data/clone-olivier-julien/map.json', 'utf8'))
  const customer = Object.values(map.contacts)[0] as string
  bannerCompte('ÉCRITURE')
  const cree = await pousserDevisGroupe({ customer, description: 'TEST H TVA (brouillon) - I3 peinture', lines: construit.lines, chantierId: CHANTIER_CR })
  console.log(`Brouillon : ${cree.id}`)

  const relu = await getModeleExpand(cree.id)
  const distDevis = distributionTaux(relu.lines)
  console.log(`TVA du DEVIS genere  : ${fmtDist(distDevis)} | taxable=${relu.taxable} taxTotal=${relu.taxTotal}`)

  // Toutes les lignes du devis portent un taux > 0 (TVA recopiee).
  const sansTaux = Array.from(distDevis.entries()).filter(([t]) => t === 0).reduce((s, [, n]) => s + n, 0)
  ok(sansTaux === 0, 'Aucune ligne du devis sans taux de TVA', `lignes a 0% = ${sansTaux}`)
  // Les taux du devis sont un sous-ensemble des taux du modele (fidelite, aucun taux invente).
  const tauxModele = new Set(Array.from(distModele.keys()).filter((t) => t > 0))
  const tauxDevisInconnus = Array.from(distDevis.keys()).filter((t) => t > 0 && !tauxModele.has(t))
  ok(tauxDevisInconnus.length === 0, 'Les taux du devis suivent ceux du modele (aucun taux force/invente)', tauxDevisInconnus.map((t) => `${t / 100}%`).join(',') || 'ok')

  // TVA theorique (ce que donnerait le compte assujetti) = somme(subtotal * taux).
  let tvaTheorique = 0
  const sommeTaux = (ls: any[]) => { for (const l of ls ?? []) { if (l.type === 'product') tvaTheorique += Math.round((l.subtotal ?? 0) * (l.taxRate ?? 0) / 10000); if (l.type === 'group') sommeTaux(l.lines) } }
  sommeTaux(relu.lines)
  console.log(`TVA theorique (lignes x taux) = ${tvaTheorique} c = ${(tvaTheorique / 100).toFixed(2)} € | HT = ${(relu.subtotal / 100).toFixed(2)} €`)
  ok(tvaTheorique > 0, 'TVA theorique calculable depuis les lignes (sera agregee sur compte assujetti)')
  console.log(`NB : taxTotal=${relu.taxTotal} sur le compte test car NON ASSUJETTI (limite compte, pas du code).`)

  // ---------- PARTIE B : IDEMPOTENCE ----------
  console.log('\n========== PARTIE B : IDEMPOTENCE DU DEVIS ==========')
  const urlCR = await recupererUrlRapportPdf(CHANTIER_CR)

  // Baseline propre : on supprime tous les brouillons referencant ce chantier.
  bannerCompte('ÉCRITURE')
  const baseline = await brouillonsReferencant(CHANTIER_CR)
  for (const id of baseline) { await del(id); await sleep(300) }
  console.log(`Baseline nettoyee : ${baseline.length} brouillon(s) supprime(s).`)

  // AVANT (comportement sans idempotence) : 2 pushs bruts = 2 brouillons.
  await sleep(2000)
  const descRef = `AVANT idempotence - <a href="${urlCR}">CR</a>`
  const a1 = await rawPost({ customer, description: descRef, lines: construit.lines })
  await sleep(1500)
  const a2 = await rawPost({ customer, description: descRef, lines: construit.lines })
  const idA1 = a1.body?.data?.id ?? a1.body?.id
  const idA2 = a2.body?.data?.id ?? a2.body?.id
  await sleep(1500)
  const avant = await brouillonsReferencant(CHANTIER_CR)
  console.log(`AVANT : 2 pushs bruts -> ${avant.length} brouillons referencant le chantier`)
  ok(avant.length === 2, 'AVANT (sans idempotence) : 2 brouillons accumules', `${avant.length}`)
  // Nettoyage des 2 brouillons "avant".
  for (const id of [idA1, idA2]) if (id) { await del(id); await sleep(1200) }

  // APRES (chemin idempotent) : 2 pushs successifs = 1 seul brouillon.
  await sleep(3000) // cooldown anti rate-limit (rafale de test, pas un cas prod)
  bannerCompte('ÉCRITURE')
  const p1 = await pousserDevisGroupe({ customer, description: 'APRES idempotence - push 1', lines: construit.lines, chantierId: CHANTIER_CR })
  await sleep(3000)
  const p2 = await pousserDevisGroupe({ customer, description: 'APRES idempotence - push 2', lines: construit.lines, chantierId: CHANTIER_CR })
  console.log(`APRES : push1=${p1.id} puis push2=${p2.id}`)
  await sleep(600)
  const statutP1 = await getStatus(p1.id)
  const statutP2 = await getStatus(p2.id)
  ok(p1.id !== p2.id, 'Le 2e push a cree un nouveau brouillon (remplacement)')
  ok(statutP1 === 404, 'L\'ancien brouillon (push1) a ete supprime', `GET push1 = ${statutP1}`)
  ok(statutP2 === 200, 'Le nouveau brouillon (push2) existe', `GET push2 = ${statutP2}`)
  const apres = await brouillonsReferencant(CHANTIER_CR)
  ok(apres.length === 1, 'APRES (idempotent) : 1 seul brouillon, pas d\'accumulation', `${apres.length}`)

  // ---------- SYNTHESE ----------
  console.log('\n########  SYNTHESE  ########')
  console.log(`A) TVA modele  : ${fmtDist(distModele)}`)
  console.log(`   TVA devis   : ${fmtDist(distDevis)}  -> fidele ligne par ligne`)
  console.log(`   TVA theorique devis : ${(tvaTheorique / 100).toFixed(2)} € (taxTotal=${relu.taxTotal} c sur compte test non assujetti)`)
  console.log(`B) Idempotence : AVANT ${avant.length} brouillons -> APRES ${apres.length} brouillon`)
  console.log(`   Brouillon temoin final : ${p2.id}`)
  console.log(`\nAssertions : ${total - echecs}/${total} OK${echecs ? ` | ${echecs} ECHEC(S)` : ''}`)
  console.log('########  FIN  ########\n')
  if (echecs) process.exit(1)
}

main().catch((e) => { console.error('\n❌ ERREUR :', e); process.exit(1) })
