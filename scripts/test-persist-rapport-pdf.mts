// =============================================================
// Test etape 1 (Phase G) : persistance du PDF + URL stable (compte test Julien)
// =============================================================
// Verifie sur un rapport existant (Residence Charles Daquin) que :
//  1. persistRapportPdf produit le PDF et l'envoie dans le Storage,
//  2. l'objet existe bien dans le bucket 'rapports' au chemin {chantier_id}.pdf,
//  3. l'URL stable est stockee dans rapports.pdf_url,
//  4. l'URL publique ouvre bien un vrai PDF,
//  5. la regeneration ecrase au meme chemin (pas d'accumulation, URL inchangee).
//
// Lecture/ecriture sur le compte test uniquement (service_role). Aucun Costructor.
// Lancer : npx tsx --env-file=.env.local scripts/test-persist-rapport-pdf.mts

import { createClient } from '@supabase/supabase-js'
import { persistRapportPdf } from '../lib/rapport-pdf'

const CHANTIER = 'f0ff75dc-b2f6-4034-95b3-d6c417c84456' // Residence Charles Daquin (3 photos)

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const sb = createClient(url, key, { auth: { persistSession: false } })

const ok = (c: boolean, label: string, detail = '') =>
  console.log(`${c ? '✅' : '❌'} ${label}${detail ? `  (${detail})` : ''}`)

async function main() {
  console.log('\n########  TEST PERSISTANCE PDF COMPTE RENDU  ########\n')

  // 1) Persiste
  const r1 = await persistRapportPdf(CHANTIER)
  console.log(`persistRapportPdf -> path=${r1.path} | ${r1.taille} octets`)
  console.log(`  URL : ${r1.url}`)
  ok(r1.path === `${CHANTIER}.pdf`, 'Chemin deterministe {chantier_id}.pdf', r1.path)

  // 2) Objet present dans le bucket
  const { data: liste } = await sb.storage.from('rapports').list('', { search: `${CHANTIER}.pdf` })
  const objet = liste?.find((o) => o.name === `${CHANTIER}.pdf`)
  ok(!!objet, 'Objet present dans le bucket rapports')

  // 3) URL stockee en base == URL renvoyee
  const { data: row } = await sb.from('rapports').select('pdf_url').eq('chantier_id', CHANTIER).single()
  ok(!!row?.pdf_url, 'rapports.pdf_url renseigne en base', row?.pdf_url ?? '(vide)')
  ok(row?.pdf_url === r1.url, 'URL en base == URL renvoyee')

  // 4) L'URL publique ouvre un vrai PDF
  const res = await fetch(r1.url)
  const buf = Buffer.from(await res.arrayBuffer())
  const entete = buf.subarray(0, 4).toString('latin1')
  ok(res.ok && res.status === 200, `URL publique accessible (HTTP ${res.status})`)
  ok(entete === '%PDF', `Contenu = PDF valide (entete "${entete}")`)
  ok(buf.length > 5000, 'PDF non vide', `${buf.length} octets`)

  // 5) Regeneration : ecrasement au meme chemin, URL inchangee, pas d'accumulation
  const r2 = await persistRapportPdf(CHANTIER)
  ok(r2.url === r1.url, 'Regeneration : URL identique (chemin deterministe)')
  const { data: liste2 } = await sb.storage.from('rapports').list('', { search: `${CHANTIER}.pdf` })
  const occurrences = (liste2 ?? []).filter((o) => o.name === `${CHANTIER}.pdf`).length
  ok(occurrences === 1, 'Regeneration : 1 seul objet (pas d\'accumulation)', `occurrences=${occurrences}`)

  console.log('\n########  FIN  ########\n')
}

main().catch((e) => {
  console.error('\n❌ ERREUR :', e)
  process.exit(1)
})
