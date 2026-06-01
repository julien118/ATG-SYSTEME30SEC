'use client'

// =============================================================
// Assistant de consultation des devis (widget de chat flottant)
// =============================================================
// Bouton flottant en bas a droite ; au clic, une fenetre de chat s'ouvre avec un
// accueil et des exemples cliquables. Olivier pose ses questions, le bot repond
// via /api/assistant-devis (qui appelle le moteur lib/devis-historique.ts).
//
// LECTURE SEULE : le widget ne fait qu'interroger et afficher. Aucun stockage
// navigateur (etat React uniquement, pas de localStorage).

import { useEffect, useRef, useState } from 'react'

interface Message {
  id: number
  role: 'user' | 'bot'
  texte: string
}

const EXEMPLES = [
  'Mon prix moyen sur les ravalements',
  'Mes 3 plus gros devis',
  'Le total de mes devis d\'ITE',
]

const ACCUEIL =
  'Bonjour Olivier, que souhaitez-vous savoir sur vos devis ? Posez-moi une question, je consulte votre historique.'

// Convertit le texte du bot (sauts de ligne + **gras**) en elements React, sans
// injection HTML (on construit les noeuds nous-memes).
function formaterLigne(ligne: string) {
  return ligne.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}
function formaterTexte(texte: string) {
  return texte.split('\n').map((ligne, i) =>
    ligne.trim() === '' ? (
      <div key={i} className="h-2" />
    ) : (
      <p key={i}>{formaterLigne(ligne)}</p>
    ),
  )
}

export default function AssistantDevis() {
  const [ouvert, setOuvert] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [saisie, setSaisie] = useState('')
  const [reflexion, setReflexion] = useState(false)
  const compteur = useRef(0)
  const finRef = useRef<HTMLDivElement>(null)
  const champRef = useRef<HTMLInputElement>(null)

  // Defile en bas a chaque nouveau message / pendant la reflexion.
  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, reflexion])

  // Focus sur le champ a l'ouverture.
  useEffect(() => {
    if (ouvert) champRef.current?.focus()
  }, [ouvert])

  async function envoyer(texte: string) {
    const question = texte.trim()
    if (!question || reflexion) return
    const idUser = compteur.current++
    setMessages((m) => [...m, { id: idUser, role: 'user', texte: question }])
    setSaisie('')
    setReflexion(true)
    try {
      const res = await fetch('/api/assistant-devis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      const data = await res.json().catch(() => ({}))
      const reponse =
        res.ok && data.reponse
          ? data.reponse
          : data.error || 'Désolé, je n\'ai pas pu répondre.'
      setMessages((m) => [...m, { id: compteur.current++, role: 'bot', texte: reponse }])
    } catch {
      setMessages((m) => [
        ...m,
        { id: compteur.current++, role: 'bot', texte: 'Désolé, je n\'ai pas pu répondre. Vérifiez la connexion.' },
      ])
    } finally {
      setReflexion(false)
    }
  }

  return (
    <>
      {/* Bouton flottant */}
      {!ouvert && (
        <button
          onClick={() => setOuvert(true)}
          aria-label="Ouvrir l'assistant devis"
          className="fixed right-5 z-50 h-14 w-14 rounded-full bg-primary text-white shadow-lg shadow-primary/30 flex items-center justify-center hover:bg-primary-dark active:scale-95 transition animate-scale-in"
          // Empilee AU-DESSUS du bouton "ajouter une visite" (bottom-8 = 32px,
          // marge mb-safe = max(12px, safe-area), hauteur 56px) avec un ecart
          // constant de 16px : 32 + 56 + 16 = 104px (6.5rem), plus le MEME socle
          // mb-safe pour que l'ecart reste de 16px avec ou sans safe-area iOS.
          // Ainsi la pastille ne chevauche jamais le bouton d'ajout (prioritaire)
          // ni les barres CTA en bas de page.
          style={{ bottom: 'calc(6.5rem + max(12px, env(safe-area-inset-bottom)))' }}
        >
          <IconeBot className="h-7 w-7" />
        </button>
      )}

      {/* Fenetre de chat */}
      {ouvert && (
        <div
          className="fixed z-50 inset-x-3 bottom-3 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[384px] flex flex-col rounded-2xl bg-white shadow-2xl border border-border overflow-hidden animate-scale-in"
          style={{
            height: 'min(78vh, 600px)',
            marginBottom: 'env(safe-area-inset-bottom)',
          }}
          role="dialog"
          aria-label="Assistant devis"
        >
          {/* En-tete */}
          <div className="flex items-center gap-3 bg-header text-white px-4 py-3">
            <div className="h-9 w-9 rounded-full bg-primary flex items-center justify-center shrink-0">
              <IconeBot className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">Assistant devis</p>
              <p className="text-[11px] text-white/60 leading-tight">Consultation - lecture seule</p>
            </div>
            <button
              onClick={() => setOuvert(false)}
              aria-label="Fermer"
              className="text-white/70 hover:text-white p-1"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Conversation */}
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-3 bg-background">
            {/* Accueil */}
            <Bulle role="bot">{ACCUEIL}</Bulle>

            {/* Exemples cliquables (tant qu'aucune question n'a ete posee) */}
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2 pl-1">
                {EXEMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => envoyer(ex)}
                    className="text-xs text-primary-dark bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-full px-3 py-1.5 transition active:scale-95"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m) => (
              <Bulle key={m.id} role={m.role}>
                {m.role === 'bot' ? formaterTexte(m.texte) : m.texte}
              </Bulle>
            ))}

            {/* Indicateur de reflexion */}
            {reflexion && (
              <div className="flex justify-start">
                <div className="bg-white border border-border rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
                  <span className="flex gap-1">
                    <Point delai="0ms" /><Point delai="150ms" /><Point delai="300ms" />
                  </span>
                </div>
              </div>
            )}

            <div ref={finRef} />
          </div>

          {/* Saisie */}
          <form
            onSubmit={(e) => { e.preventDefault(); envoyer(saisie) }}
            className="flex items-center gap-2 border-t border-border bg-white px-3 py-2.5"
          >
            <input
              ref={champRef}
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              placeholder="Posez votre question..."
              className="flex-1 min-w-0 rounded-full bg-input-bg border border-border focus:border-primary focus:bg-input-focus outline-none px-4 py-2.5 text-sm"
              enterKeyHint="send"
            />
            <button
              type="submit"
              disabled={!saisie.trim() || reflexion}
              aria-label="Envoyer"
              className="h-10 w-10 shrink-0 rounded-full bg-primary text-white flex items-center justify-center disabled:opacity-40 enabled:hover:bg-primary-dark enabled:active:scale-95 transition"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  )
}

// ---------- Sous-composants ----------

function Bulle({ role, children }: { role: 'user' | 'bot'; children: React.ReactNode }) {
  const estUser = role === 'user'
  return (
    <div className={`flex ${estUser ? 'justify-end' : 'justify-start'} animate-card-appear`}>
      <div
        className={`max-w-[85%] px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
          estUser
            ? 'bg-primary text-white rounded-2xl rounded-br-md'
            : 'bg-white text-foreground border border-border rounded-2xl rounded-bl-md'
        }`}
      >
        {children}
      </div>
    </div>
  )
}

function Point({ delai }: { delai: string }) {
  return (
    <span
      className="h-2 w-2 rounded-full bg-primary/60 animate-bounce"
      style={{ animationDelay: delai }}
    />
  )
}

function IconeBot({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
      <line x1="8" y1="16" x2="8" y2="16" />
      <line x1="16" y1="16" x2="16" y2="16" />
    </svg>
  )
}
