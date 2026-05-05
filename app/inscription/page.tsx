'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import LogoLink from '@/components/LogoLink'

const METIERS = [
  'Maçonnerie / Gros œuvre',
  'Couverture / Charpente',
  'Plomberie / Chauffage',
  'Électricité',
  'Peinture / Revêtements',
  'Menuiserie',
  'Carrelage / Sols',
  'Isolation / Façades',
  'Maître d\'œuvre',
  'Bureau d\'études',
  'Rénovation générale',
  'Autre',
]

type FormState = 'form' | 'sending' | 'sent' | 'error'

export default function InscriptionPage() {
  const [prenom, setPrenom] = useState('')
  const [nom, setNom] = useState('')
  const [email, setEmail] = useState('')
  const [telephone, setTelephone] = useState('')
  const [metier, setMetier] = useState('')
  const [entreprise, setEntreprise] = useState('')
  const [state, setState] = useState<FormState>('form')
  const [errorMsg, setErrorMsg] = useState('')
  const [showLogin, setShowLogin] = useState(false)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginState, setLoginState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [loginError, setLoginError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setState('sending')
    setErrorMsg('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
        data: {
          prenom,
          nom,
          telephone: telephone || null,
          metier: metier || null,
          entreprise: entreprise || null,
        },
      },
    })

    if (error) {
      setState('error')
      // Auth error handled via UI
      if (error.message.includes('rate limit')) {
        setErrorMsg('Trop de tentatives. Veuillez réessayer dans quelques minutes.')
      } else {
        setErrorMsg('Une erreur est survenue. Vérifiez votre email et réessayez.')
      }
    } else {
      setState('sent')
    }
  }

  if (state === 'sent') {
    return (
      <main className="min-h-screen-safe bg-background flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-md text-center animate-scale-in">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center mx-auto mb-6">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-3">
            Vérifiez votre boîte mail
          </h1>
          <p className="text-gray-500 mb-2">
            Un lien de connexion a été envoyé à
          </p>
          <p className="font-semibold text-foreground mb-6">{email}</p>
          <p className="text-gray-500 text-sm mb-4">
            Cliquez sur le lien dans l&apos;email pour accéder à votre espace.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
            📬 Si vous ne voyez pas l&apos;email, vérifiez votre dossier <strong>Spam</strong> ou <strong>Courrier indésirable</strong>.
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen-safe bg-background flex flex-col">
      {/* Header */}
      <header className="px-6 py-4 pt-safe flex items-center justify-between">
        <LogoLink width={120} height={28} priority />
        <a href="https://ionnyx.fr/" className="text-sm font-medium border border-primary text-primary rounded-lg px-4 py-2 hover:bg-primary hover:text-white transition-colors whitespace-nowrap">
          Voir le site IONNYX →
        </a>
      </header>

      {/* Form */}
      <div className="flex-1 flex flex-col items-center px-6 pt-4 pb-12">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-bold text-foreground mb-1">
            Créez votre accès gratuit
          </h1>
          <p className="text-gray-500 mb-8">
            2 rapports de visite offerts pour tester l&apos;outil.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Prénom + Nom */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="prenom" className="block text-sm font-medium text-foreground mb-1.5">
                  Prénom <span className="text-red-400">*</span>
                </label>
                <input
                  id="prenom"
                  type="text"
                  value={prenom}
                  onChange={(e) => setPrenom(e.target.value)}
                  required
                  placeholder="Jean"
                  className="input-ionnyx"
                />
              </div>
              <div>
                <label htmlFor="nom" className="block text-sm font-medium text-foreground mb-1.5">
                  Nom <span className="text-red-400">*</span>
                </label>
                <input
                  id="nom"
                  type="text"
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  required
                  placeholder="Dupont"
                  className="input-ionnyx"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                Email <span className="text-red-400">*</span>
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="jean.dupont@entreprise.fr"
                className="input-ionnyx"
              />
            </div>

            {/* Téléphone */}
            <div>
              <label htmlFor="telephone" className="block text-sm font-medium text-foreground mb-1.5">
                Téléphone <span className="text-gray-300 text-xs font-normal">optionnel</span>
              </label>
              <input
                id="telephone"
                type="tel"
                value={telephone}
                onChange={(e) => setTelephone(e.target.value)}
                placeholder="06 12 34 56 78"
                className="input-ionnyx"
              />
            </div>

            {/* Métier */}
            <div>
              <label htmlFor="metier" className="block text-sm font-medium text-foreground mb-1.5">
                Métier
              </label>
              <select
                id="metier"
                value={metier}
                onChange={(e) => setMetier(e.target.value)}
                className="input-ionnyx appearance-none"
              >
                <option value="">Sélectionnez votre métier</option>
                {METIERS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Entreprise */}
            <div>
              <label htmlFor="entreprise" className="block text-sm font-medium text-foreground mb-1.5">
                Entreprise <span className="text-gray-300 text-xs font-normal">optionnel</span>
              </label>
              <input
                id="entreprise"
                type="text"
                value={entreprise}
                onChange={(e) => setEntreprise(e.target.value)}
                placeholder="Nom de votre entreprise"
                className="input-ionnyx"
              />
            </div>

            {/* Error */}
            {state === 'error' && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 animate-fade-in">
                <p className="text-red-600 text-sm">{errorMsg}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={state === 'sending'}
              className="btn-primary w-full text-lg py-4 mt-2"
            >
              {state === 'sending' ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Envoi en cours...
                </span>
              ) : (
                'Recevoir mon accès'
              )}
            </button>
          </form>

          <p className="text-gray-400 text-xs text-center mt-6">
            Vous recevrez un lien de connexion par email.{' '}
            Pas de mot de passe à retenir.
          </p>

          {/* Login section */}
          <div className="mt-8 pt-6 border-t border-border">
            {!showLogin && loginState !== 'sent' && (
              <button
                onClick={() => setShowLogin(true)}
                className="w-full text-gray-400 text-sm hover:text-foreground transition-colors"
              >
                J&apos;ai déjà un compte
              </button>
            )}

            {showLogin && loginState !== 'sent' && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  setLoginState('sending')
                  setLoginError('')
                  const supabase = createClient()
                  const { error } = await supabase.auth.signInWithOtp({
                    email: loginEmail,
                    options: {
                      emailRedirectTo: `${window.location.origin}/api/auth/callback`,
                    },
                  })
                  if (error) {
                    setLoginState('error')
                    if (error.message.includes('rate limit')) {
                      setLoginError('Trop de tentatives. Réessayez dans quelques minutes.')
                    } else {
                      setLoginError('Une erreur est survenue. Vérifiez votre email et réessayez.')
                    }
                  } else {
                    setLoginState('sent')
                  }
                }}
                className="space-y-3 animate-fade-in"
              >
                <p className="text-sm text-gray-500 text-center mb-2">Entrez votre email pour recevoir un lien de connexion</p>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="Votre adresse email"
                  required
                  className="input-ionnyx"
                  autoFocus
                />
                {loginState === 'error' && (
                  <p className="text-red-500 text-sm">{loginError}</p>
                )}
                <button
                  type="submit"
                  disabled={loginState === 'sending'}
                  className="btn-secondary w-full"
                >
                  {loginState === 'sending' ? 'Envoi...' : 'Recevoir mon lien'}
                </button>
              </form>
            )}

            {loginState === 'sent' && (
              <div className="bg-input-focus border border-primary/20 rounded-xl p-4 animate-scale-in text-center">
                <p className="text-primary font-medium">Lien envoyé !</p>
                <p className="text-gray-500 text-sm mt-1">Vérifiez votre boîte mail.</p>
                <p className="text-amber-600 text-xs mt-2">📬 Pensez à vérifier vos spams si vous ne le voyez pas.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
