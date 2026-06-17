// Vérifie le CHEMIN CRITIQUE du login : avec la clé ANON (comme le navigateur),
// signInWithPassword(email, mot de passe) doit renvoyer une session valide.
// Lecture seule côté données. Lancement :
//   node --env-file=.env.local scripts/verifier-login-auth.mjs

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const email = (process.argv[2] || process.env.APP_ACCESS_EMAIL || '').trim().toLowerCase()
const password = process.env.APP_ACCESS_PASSWORD || ''

const supabase = createClient(url, anon, { auth: { persistSession: false } })

const { data, error } = await supabase.auth.signInWithPassword({ email, password })
if (error) {
  console.error('✗ ÉCHEC signInWithPassword :', error.message)
  process.exit(1)
}
const aSession = Boolean(data.session?.access_token)
console.log('✓ Session établie :', aSession)
console.log('  user id  :', data.user?.id)
console.log('  email    :', data.user?.email)
console.log('  rôle JWT :', data.session ? 'authenticated' : '(aucun)')
// Nettoyage : on referme la session de test.
await supabase.auth.signOut()
process.exit(aSession ? 0 : 1)
