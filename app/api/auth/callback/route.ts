import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/chantiers'

  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  console.log('Auth callback params:', { code: !!code, token_hash: !!token_hash, type, url: request.url })

  // Handle PKCE flow (code exchange)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    console.log('Code exchange result:', error?.message ?? 'success')
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Handle token_hash flow (email confirmation link)
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as 'signup' | 'email' | 'magiclink',
    })
    console.log('OTP verify result:', error?.message ?? 'success')
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  console.log('Auth callback fallthrough - no code or token_hash matched')
  return NextResponse.redirect(`${origin}/inscription?error=auth`)
}
