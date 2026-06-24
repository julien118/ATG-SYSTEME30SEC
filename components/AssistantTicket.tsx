'use client'

// =============================================================
// "Demander à Julien" — bouton d'aide dans la barre noire (en-tête)
// =============================================================
// Petit bouton « ? » placé en haut à droite, DANS l'en-tête noir de chaque page
// (inséré comme enfant de flux pour un alignement vertical parfait, sans overlay
// flottant). Au clic, un panneau déroulant s'ouvre en haut à droite avec deux
// onglets :
//   - Nouveau message : Olivier écrit (texte seul) -> POST /api/tickets -> notif
//     Telegram instantanée à Julien (avec le contexte : page, chantier, appareil).
//   - Mes demandes : la liste de ses tickets ; quand Julien répond (en "répondant"
//     au message Telegram), la réponse remonte ici (pastille rouge sur le bouton).
//
// `className` permet de pousser le bouton à droite dans un en-tête `flex` (ml-auto).

import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useToast } from './ToastProvider'
import type { TicketPublic } from '@/lib/types'

const fmtDate = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
function formaterDate(iso: string): string {
  try {
    return fmtDate.format(new Date(iso))
  } catch {
    return ''
  }
}

export default function AssistantTicket({ className = '' }: { className?: string }) {
  const pathname = usePathname()
  const toast = useToast()
  const [ouvert, setOuvert] = useState(false)
  const [vue, setVue] = useState<'nouveau' | 'liste'>('nouveau')
  const [saisie, setSaisie] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [tickets, setTickets] = useState<TicketPublic[]>([])
  const [nonLus, setNonLus] = useState(0)
  const [chargement, setChargement] = useState(false)

  // --- Chargement des demandes : au montage + rafraichissement quand ouvert ---
  const rafraichir = useCallback(async () => {
    try {
      const res = await fetch('/api/tickets')
      const data = await res.json().catch(() => ({}))
      setTickets(Array.isArray(data.tickets) ? data.tickets : [])
      setNonLus(typeof data.nonLus === 'number' ? data.nonLus : 0)
    } catch {
      // silencieux : la pastille reste a sa derniere valeur connue.
    }
  }, [])

  useEffect(() => {
    setChargement(true)
    rafraichir().finally(() => setChargement(false))
    if (!ouvert) return
    const id = setInterval(rafraichir, 30000)
    return () => clearInterval(id)
  }, [ouvert, rafraichir])

  // A l'ouverture de "Mes demandes" : marquer les reponses comme lues.
  useEffect(() => {
    if (!ouvert || vue !== 'liste') return
    setNonLus(0)
    setTickets((prev) => prev.map((t) => (t.lu_par_olivier ? t : { ...t, lu_par_olivier: true })))
    fetch('/api/tickets/lu', { method: 'POST' }).catch(() => {})
  }, [ouvert, vue])

  function capturerContexte() {
    const m = pathname.match(/\/chantiers\/([0-9a-f-]{36})/i)
    return {
      path: pathname,
      chantierId: m?.[1],
      viewport: typeof window !== 'undefined' ? `${window.innerWidth}×${window.innerHeight}` : undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : undefined,
    }
  }

  async function envoyer() {
    const message = saisie.trim()
    if (!message || envoi) return
    setEnvoi(true)
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, contexte: capturerContexte() }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setSaisie('')
        toast.show(
          data.notifEnvoyee === false
            ? 'Message enregistré, il sera transmis à Julien.'
            : 'Message envoyé à Julien',
          data.notifEnvoyee === false ? 'info' : 'success',
        )
        setVue('liste')
        await rafraichir()
      } else {
        toast.show('Envoi impossible, réessayez.', 'error')
      }
    } catch {
      toast.show('Envoi impossible, vérifiez la connexion.', 'error')
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <>
      {/* Bouton « ? » dans la barre noire */}
      <button
        onClick={() => setOuvert((o) => !o)}
        aria-label="Aide — contacter Julien"
        aria-expanded={ouvert}
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-300 hover:text-white hover:bg-white/10 active:scale-95 transition-colors ${className}`}
      >
        <IconeAide className="h-5 w-5" />
        {nonLus > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-header">
            {nonLus}
          </span>
        )}
      </button>

      {/* Panneau déroulant en haut à droite */}
      {ouvert && (
        <>
          {/* Zone de clic pour fermer (transparente). */}
          <div className="fixed inset-0 z-40" onClick={() => setOuvert(false)} aria-hidden />
          <div
            className="fixed z-50 right-2 left-2 sm:left-auto sm:right-3 sm:w-[384px] flex flex-col rounded-2xl bg-white shadow-2xl border border-border overflow-hidden animate-scale-in"
            style={{ top: 'calc(env(safe-area-inset-top) + 4rem)', maxHeight: '78vh' }}
            role="dialog"
            aria-label="Demander à Julien"
          >
            {/* En-tete */}
            <div className="flex items-center gap-3 bg-header text-white px-4 py-3">
              <div className="h-9 w-9 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                <IconeAide className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight">Demander à Julien</p>
                <p className="text-xs text-white/60 leading-tight">Question, souci ou idée</p>
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

            {/* Onglets */}
            <div className="flex border-b border-border bg-white shrink-0">
              <Onglet actif={vue === 'nouveau'} onClick={() => setVue('nouveau')}>
                Nouveau message
              </Onglet>
              <Onglet actif={vue === 'liste'} onClick={() => setVue('liste')}>
                <span className="inline-flex items-center gap-1.5">
                  Mes demandes
                  {nonLus > 0 && (
                    <span className="h-4 min-w-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
                      {nonLus}
                    </span>
                  )}
                </span>
              </Onglet>
            </div>

            {/* Contenu */}
            {vue === 'nouveau' ? (
              <div className="flex-1 min-h-0 flex flex-col px-4 py-4 bg-background">
                <p className="text-sm text-gray-600 mb-3">
                  Une question, un souci ou une idée d&apos;amélioration ? Écrivez-le ici : Julien
                  est notifié tout de suite et vous répond directement dans l&apos;app.
                </p>
                <textarea
                  value={saisie}
                  onChange={(e) => setSaisie(e.target.value)}
                  placeholder="Décrivez votre question ou votre problème…"
                  className="flex-1 min-h-[120px] w-full resize-none rounded-xl bg-input-bg border border-border focus:border-primary focus:bg-input-focus outline-none px-3.5 py-3 text-sm leading-relaxed"
                />
                <button
                  onClick={envoyer}
                  disabled={!saisie.trim() || envoi}
                  className="btn-primary mt-3 w-full"
                >
                  {envoi ? 'Envoi…' : 'Envoyer à Julien'}
                </button>
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4 bg-background">
                {chargement && tickets.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center pt-8">Chargement…</p>
                ) : tickets.length === 0 ? (
                  <div className="text-center pt-8 px-4">
                    <p className="text-sm text-gray-500">Aucune demande pour l&apos;instant.</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Posez votre première question à Julien depuis l&apos;onglet « Nouveau message ».
                    </p>
                  </div>
                ) : (
                  tickets.map((t) => <CarteTicket key={t.id} ticket={t} />)
                )}
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}

// ---------- Sous-composants ----------

function Onglet({ actif, onClick, children }: { actif: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-2.5 text-sm font-medium transition-colors ${
        actif
          ? 'text-primary border-b-2 border-primary'
          : 'text-gray-500 border-b-2 border-transparent hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

function CarteTicket({ ticket }: { ticket: TicketPublic }) {
  return (
    <div className="space-y-2">
      {/* Message d'Olivier */}
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-primary text-white rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm leading-relaxed shadow-sm whitespace-pre-wrap">
          {ticket.message}
        </div>
      </div>
      <p className="text-[11px] text-gray-400 text-right pr-1">{formaterDate(ticket.created_at)}</p>

      {/* Reponse de Julien, ou attente */}
      {ticket.reponse ? (
        <div className="space-y-1">
          <div className="flex justify-start">
            <div className="max-w-[85%] bg-white text-foreground border border-border rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-relaxed shadow-sm whitespace-pre-wrap">
              {ticket.reponse}
            </div>
          </div>
          <p className="text-[11px] text-gray-400 pl-1">
            Julien{ticket.repondu_le ? ` · ${formaterDate(ticket.repondu_le)}` : ''}
          </p>
        </div>
      ) : (
        <p className="text-xs text-gray-400 italic pl-1">En attente de la réponse de Julien…</p>
      )}
    </div>
  )
}

function IconeAide({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}
