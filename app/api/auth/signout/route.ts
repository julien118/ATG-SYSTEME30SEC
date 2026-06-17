import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { COOKIE_NAME } from '@/lib/auth-gate'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Efface le cookie de session maison (accès aux pages) ET la session Supabase
// Auth (accès aux données). Le client redirige ensuite vers /login.
export async function POST() {
  cookies().delete(COOKIE_NAME)
  try {
    await createClient().auth.signOut()
  } catch {
    // Une déconnexion Supabase qui échoue ne doit pas bloquer le logout.
  }
  return NextResponse.json({ ok: true })
}
