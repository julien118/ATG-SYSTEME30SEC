// Verification du prompt recalibre (style Olivier) : genere un devis a partir
// des 3 observations Dupont + la bibliotheque re-seedee, puis controle :
//   - longueur des descriptions (cible 100 a 150 caracteres)
//   - tous les articles sont bien dans la whitelist (bibliotheque)
//
// Lancement : npx tsx --env-file=.env.local scripts/test-prompt-olivier.mts

import { proposerDevis } from '../lib/quote-proposer'
import type { ArticleBibliotheque } from '../lib/types'

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY

const VOCAUX = [
  'Façade sud, façade exposée plein soleil, support en bon état général, quelques fissures en escalier sur la partie haute, on part sur un ravalement I3.',
  'Façade nord, façade saine, pas de dégradation visible, juste un peu de mousse sur le bas, lavage puis ravalement I3.',
  'Pignon Est, fissures actives sur toute la hauteur, on traite en imperméabilité I4 avec entoilage.',
]

async function main() {
  const r = await fetch(`${SUPA}/rest/v1/bibliotheque_costructor?select=*`, {
    headers: { apikey: SR!, Authorization: `Bearer ${SR}` },
  })
  const biblio = (await r.json()) as ArticleBibliotheque[]
  const ids = new Set(biblio.map((b) => b.costructor_article_id))
  console.log(`Bibliotheque : ${biblio.length} articles\n`)

  const sections = await proposerDevis(VOCAUX, biblio)

  let nbArticles = 0
  let horsBiblio = 0
  let horsLongueur = 0
  for (const s of sections) {
    console.log(`\n## ${s.nom}`)
    for (const a of s.articles) {
      nbArticles++
      const d = a.description_technique ?? ''
      const len = d.length
      const okId = ids.has(a.costructor_article_id)
      if (!okId) horsBiblio++
      if (len > 150) horsLongueur++
      const flagLen = len > 150 ? ' [>150 !]' : len < 80 ? ' [court]' : ''
      console.log(`  - (${String(len).padStart(3)} car${flagLen}) ${okId ? '' : '[HORS BIBLIO!] '}${a.libelle.slice(0, 40)}`)
      console.log(`      "${d}"`)
    }
  }

  console.log('\n=============================================================')
  console.log(`Articles : ${nbArticles} | hors bibliotheque : ${horsBiblio} | descriptions > 150 car : ${horsLongueur}`)
  console.log(horsBiblio === 0 && horsLongueur === 0
    ? '==> OK : whitelist respectee et descriptions courtes (style Olivier).'
    : '==> A revoir (voir flags ci-dessus).')
}

main().catch((e) => { console.error(e); process.exit(1) })
