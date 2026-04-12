'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function HomeClient() {
  const [showLogin, setShowLogin] = useState(false)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
      },
    })

    setLoading(false)
    if (error) {
      setError('Une erreur est survenue. Vérifiez votre email et réessayez.')
    } else {
      setSent(true)
    }
  }

  return (
    <main className="min-h-screen-safe bg-background flex flex-col">
      {/* Header */}
      <header className="px-6 py-4 pt-safe">
        <Image
          src="/logo-ionnyx.png"
          alt="IONNYX"
          width={140}
          height={32}
          priority
        />
      </header>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-12 text-center">
        {/* Icon */}
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center mb-8 animate-scale-in">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold text-foreground leading-tight mb-4 animate-fade-in">
          Générez vos rapports de visite en{' '}
          <span className="text-primary">30 secondes</span>
        </h1>

        <p className="text-gray-500 text-lg sm:text-xl max-w-md mb-10 animate-fade-in">
          Prenez des photos, dictez vos observations.{' '}
          <span className="font-medium text-foreground">L&apos;IA fait le reste.</span>
        </p>

        {/* CTA */}
        <div className="w-full max-w-sm space-y-4 animate-fade-in">
          <Link href="/inscription" className="btn-primary w-full text-lg py-4 block text-center">
            Tester gratuitement
          </Link>

          {!showLogin && !sent && (
            <button
              onClick={() => setShowLogin(true)}
              className="text-gray-400 text-sm hover:text-foreground transition-colors"
            >
              J&apos;ai déjà un compte
            </button>
          )}

          {/* Login form */}
          {showLogin && !sent && (
            <form onSubmit={handleLogin} className="space-y-3 animate-fade-in">
              <div className="h-px bg-border my-2" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Votre adresse email"
                required
                className="input-ionnyx"
                autoFocus
              />
              {error && (
                <p className="text-red-500 text-sm">{error}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="btn-secondary w-full"
              >
                {loading ? 'Envoi en cours...' : 'Recevoir mon lien de connexion'}
              </button>
            </form>
          )}

          {/* Confirmation */}
          {sent && (
            <div className="bg-input-focus border border-primary/20 rounded-xl p-4 animate-scale-in">
              <p className="text-primary font-medium">Lien envoyé !</p>
              <p className="text-gray-500 text-sm mt-1">
                Vérifiez votre boîte mail et cliquez sur le lien pour vous connecter.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="px-6 py-4 text-center">
        <p className="text-gray-300 text-xs">
          IONNYX — Assistant de visite terrain intelligent
        </p>
      </footer>
    </main>
  )
}
