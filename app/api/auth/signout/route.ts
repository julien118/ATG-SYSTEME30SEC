import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { COOKIE_NAME } from '@/lib/auth-gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Efface le cookie de session. Le client redirige ensuite vers /login.
export async function POST() {
  cookies().delete(COOKIE_NAME)
  return NextResponse.json({ ok: true })
}
