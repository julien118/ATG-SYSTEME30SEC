// =============================================================
// Création de l'utilisateur Supabase Auth (single-user Olivier)
// =============================================================
// But : donner à l'app une VRAIE session Supabase (auth.uid() réel) afin que la
// RLS puisse protéger les données. Un seul utilisateur, ses identifiants = ceux
// de la porte d'accès maison (APP_ACCESS_EMAIL / APP_ACCESS_PASSWORD), pour que
// le MÊME formulaire de login établisse aussi la session Supabase.
//
// IDEMPOTENT : si l'utilisateur existe déjà (même email), ne fait que resynchroniser
// son mot de passe sur APP_ACCESS_PASSWORD et confirmer l'email — ne crée pas de doublon.
//
// Lancement (lit .env.local, jamais commité) :
//   node --env-file=.env.local scripts/creer-utilisateur-auth.mjs
//
// Écrit en PROD (crée un compte Auth). Réversible : suppression de l'utilisateur
// dans le dashboard Supabase (Authentication > Users) ou via admin.deleteUser.

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const email = (process.env.APP_ACCESS_EMAIL || '').trim().toLowerCase()
const password = process.env.APP_ACCESS_PASSWORD || ''

function abort(msg) {
  console.error('✗ ' + msg)
  process.exit(1)
}

if (!url || !serviceKey) abort('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant.')
if (!email || email.length < 3) abort('APP_ACCESS_EMAIL manquant/invalide.')
if (!password || password.length < 8) abort('APP_ACCESS_PASSWORD manquant/trop court.')

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Recherche d'un utilisateur existant avec cet email (pagination simple).
async function trouverParEmail(cibleEmail) {
  let page = 1
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) abort('listUsers : ' + error.message)
    const u = data.users.find((x) => (x.email || '').toLowerCase() === cibleEmail)
    if (u) return u
    if (data.users.length < 200) return null
    page += 1
  }
}

const existant = await trouverParEmail(email)

if (existant) {
  // Resync mot de passe + confirmation email (idempotent, pas de doublon).
  const { error } = await admin.auth.admin.updateUserById(existant.id, {
    password,
    email_confirm: true,
  })
  if (error) abort('updateUserById : ' + error.message)
  console.log('✓ Utilisateur Auth déjà présent, resynchronisé. uid =', existant.id)
  console.log('  email =', email)
  process.exit(0)
}

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
})
if (error) abort('createUser : ' + error.message)
console.log('✓ Utilisateur Auth créé. uid =', data.user.id)
console.log('  email =', email)
console.log('  (single-user : la RLS sera cadrée sur le rôle "authenticated", pas par uid)')
