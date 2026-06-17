// Vérifie le VERROU RLS : la clé anon (sans session) ne voit RIEN, une session
// authentifiée voit les données. N'affiche que des COMPTAGES, jamais de PII.
// Lancement : node --env-file=.env.local scripts/verifier-rls.mjs [email]

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const email = (process.argv[2] || process.env.APP_ACCESS_EMAIL || '').trim().toLowerCase()
const password = process.env.APP_ACCESS_PASSWORD || ''
const tables = ['chantiers', 'capture_items', 'rapports', 'profiles']

function n(data, error) {
  return error ? `refusé (${error.code || error.message})` : `${data?.length ?? 0} ligne(s)`
}

console.log('=== ANON (clé publique, AUCUNE session) — doit être 0/refusé ===')
const anonClient = createClient(url, anon, { auth: { persistSession: false } })
for (const t of tables) {
  const { data, error } = await anonClient.from(t).select('id')
  console.log(`  ${t.padEnd(14)}: ${n(data, error)}`)
}
// écriture anon storage (doit être refusée)
const up = await anonClient.storage
  .from('photos')
  .upload(`00000000-0000-0000-0000-0000000000a7/_rlscheck/${Date.now()}.txt`, 'x')
console.log(`  storage upload : ${up.error ? 'refusé ✓ (' + up.error.message + ')' : 'AUTORISÉ ⚠️ (à investiguer)'}`)

console.log('=== AUTHENTIFIÉ (session ' + email + ') — doit voir les données ===')
const authClient = createClient(url, anon, { auth: { persistSession: false } })
const { error: signErr } = await authClient.auth.signInWithPassword({ email, password })
if (signErr) {
  console.log('  signin échec:', signErr.message)
  process.exit(1)
}
for (const t of tables) {
  const { data, error } = await authClient.from(t).select('id')
  console.log(`  ${t.padEnd(14)}: ${n(data, error)}`)
}
await authClient.auth.signOut()
