'use client'

import { useState } from 'react'
import Image from 'next/image'
import { cibleInterneSure } from '@/lib/redirection-sure'
import { createClient } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

// Cible de redirection apres connexion : lue cote client au submit (evite la
// contrainte Suspense de useSearchParams), et sanitisee (helper partage avec le
// middleware) pour eviter tout open-redirect.
function cibleApresConnexion(): string {
  if (typeof window === 'undefined') return '/chantiers'
  return cibleInterneSure(new URLSearchParams(window.location.search).get('next'))
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [montrerMdp, setMontrerMdp] = useState(false)
  const [aideOuverte, setAideOuverte] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (enCours) return
    setErreur(null)
    setEnCours(true)
    try {
      const res = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, motDePasse }),
      })
      if (res.ok) {
        // Session Supabase Auth : c'est elle qui protège les DONNÉES via la RLS
        // (le navigateur parle directement à Supabase). Best-effort pendant la
        // transition : si l'utilisateur Auth n'existe pas encore, on ne bloque
        // pas l'accès — la porte maison (cookie HMAC) suffit aux pages.
        try {
          const supabase = createClient()
          const { error } = await supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password: motDePasse,
          })
          if (error) console.error('[auth] session Supabase non établie :', error.message)
        } catch {
          console.error('[auth] session Supabase indisponible')
        }
        window.location.assign(cibleApresConnexion())
        return
      }
      if (res.status === 429) {
        setErreur('Trop de tentatives. Patientez quelques minutes avant de réessayer.')
      } else if (res.status >= 500) {
        setErreur('Service indisponible. Réessayez ou contactez IONNYX.')
      } else {
        setErreur('Email ou mot de passe incorrect.')
      }
    } catch {
      setErreur('Connexion impossible. Vérifiez votre réseau.')
    } finally {
      setEnCours(false)
    }
  }

  return (
    <main className="min-h-screen-safe bg-background flex flex-col">
      {/* Bandeau sombre ATG */}
      <header className="bg-header px-5 py-4 pt-safe flex items-center justify-center">
        <Image
          src="/logo-atg-blanc-sans-numero.png"
          alt="ATG"
          width={128}
          height={48}
          priority
          className="h-10 w-auto"
        />
      </header>

      <div className="flex-1 flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <h1 className="text-xl font-semibold text-foreground">Votre Système 30 Secondes</h1>
            <p className="mt-1 text-sm text-gray-500">par IONNYX</p>
          </div>

          <form
            onSubmit={onSubmit}
            className="bg-white border border-border rounded-2xl p-5 shadow-sm"
          >
            <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
              Adresse e-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              autoFocus
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setErreur(null)
              }}
              className="input-ionnyx w-full"
              placeholder="vous@exemple.fr"
              aria-invalid={erreur ? true : undefined}
            />

            <label
              htmlFor="motDePasse"
              className="block text-sm font-medium text-foreground mb-2 mt-4"
            >
              Mot de passe d&apos;accès
            </label>
            <div className="relative">
              <input
                id="motDePasse"
                name="motDePasse"
                type={montrerMdp ? 'text' : 'password'}
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                value={motDePasse}
                onChange={(e) => {
                  setMotDePasse(e.target.value)
                  setErreur(null)
                }}
                className="input-ionnyx w-full pr-20"
                placeholder="••••••••"
                aria-invalid={erreur ? true : undefined}
              />
              <button
                type="button"
                onClick={() => setMontrerMdp((v) => !v)}
                aria-label={montrerMdp ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                aria-pressed={montrerMdp}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-sm font-medium text-gray-500 hover:text-foreground"
              >
                {montrerMdp ? 'Masquer' : 'Afficher'}
              </button>
            </div>

            {erreur && (
              <p className="mt-3 text-sm text-red-600" role="alert">
                {erreur}
              </p>
            )}

            <button
              type="submit"
              disabled={enCours || email.length === 0 || motDePasse.length === 0}
              className="btn-primary w-full mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {enCours ? 'Connexion…' : 'Se connecter'}
            </button>

            <button
              type="button"
              onClick={() => setAideOuverte((v) => !v)}
              className="mt-3 w-full text-center text-xs text-gray-500 hover:text-foreground underline"
            >
              Mot de passe oublié ?
            </button>
            {aideOuverte && (
              <p className="mt-2 text-xs text-gray-500 text-center">
                Vos identifiants vous ont été remis par IONNYX.{' '}
                <a href="mailto:julien@ionnyx.fr" className="underline hover:text-primary">
                  Nous contacter
                </a>
              </p>
            )}
          </form>

          <p className="mt-6 text-center text-xs text-gray-400">Accès réservé</p>
        </div>
      </div>
    </main>
  )
}
