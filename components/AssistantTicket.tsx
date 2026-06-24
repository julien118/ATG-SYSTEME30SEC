'use client'

// =============================================================
// "Demander à Julien" — canal de support flottant (bas à GAUCHE)
// =============================================================
// Bouton flottant noir en bas a gauche (le robot "Assistant devis" est en bas a
// droite, en vert : aucune collision, roles distincts). Au clic, une fenetre
// s'ouvre avec deux onglets :
//   - Nouveau message : Olivier ecrit (texte seul) -> POST /api/tickets -> notif
//     Telegram instantanee a Julien (avec le contexte : page, chantier, appareil).
//   - Mes demandes : la liste de ses tickets ; quand Julien repond (en "repondant"
//     au message Telegram), la reponse remonte ici (pastille rouge sur le bouton).
//
// Volontairement plus leger que AssistantDevis : pas de dictee, pas de fondu au
// defilement. On garde juste de quoi (a) se masquer quand une modale est ouverte
// et (b) remonter au-dessus de la barre d'action [data-bottombar] des pages devis
// /visite/rapport. Recalcul via MutationObserver debounce + resize + route — sans
// scroll listener ni rAF (la barre est flex-shrink-0, donc toujours docked en bas).

import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useToast } from './ToastProvider'
import type { TicketPublic } from '@/lib/types'

const BASE_BOTTOM = 'calc(1.5rem + env(safe-area-inset-bottom))'

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

export default function AssistantTicket() {
  const pathname = usePathname()
  const toast = useToast()
  const [ouvert, setOuvert] = useState(false)
  const [vue, setVue] = useState<'nouveau' | 'liste'>('nouveau')
  const [saisie, setSaisie] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [tickets, setTickets] = useState<TicketPublic[]>([])
  const [nonLus, setNonLus] = useState(0)
  const [chargement, setChargement] = useState(false)

  // Masquage si une modale est ouverte + remontee au-dessus de la barre d'action.
  const [masque, setMasque] = useState(false)
  const [bottomStyle, setBottomStyle] = useState<string>(BASE_BOTTOM)

  // --- Positionnement non intrusif (version allegee du robot) ---------------
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    function recompute() {
      // Modale ouverte (toutes en `.fixed.inset-0`) -> on cache le lanceur.
      setMasque(!!document.querySelector('.fixed.inset-0'))
      // Barre d'action collee au bas de la fenetre (`.fixed.bottom-0` ou en flux
      // `[data-bottombar]`) -> on remonte au-dessus, sinon socle de base.
      const vh = window.innerHeight
      let intrusion = 0
      document.querySelectorAll<HTMLElement>('.fixed.bottom-0, [data-bottombar]').forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.height > 0 && r.bottom >= vh - 2) intrusion = Math.max(intrusion, vh - r.top)
      })
      setBottomStyle(intrusion > 0 ? `${Math.round(intrusion) + 16}px` : BASE_BOTTOM)
    }
    function planifier() {
      clearTimeout(t)
      t = setTimeout(recompute, 150)
    }
    recompute()
    const mo = new MutationObserver(planifier)
    mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', planifier)
    return () => {
      clearTimeout(t)
      mo.disconnect()
      window.removeEventListener('resize', planifier)
    }
  }, [pathname])

  // --- Chargement des demandes : au montage + rafraichissement quand ouvert --
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
      {/* Bouton flottant (masque quand une modale est ouverte) */}
      {!ouvert && !masque && (
        <button
          onClick={() => setOuvert(true)}
          aria-label="Demander à Julien"
          className="fixed left-5 z-50 h-12 w-12 rounded-full bg-header text-white shadow-md shadow-black/20 flex items-center justify-center hover:bg-black active:scale-95 transition-all duration-200 animate-scale-in"
          style={{ bottom: bottomStyle }}
        >
          <IconeSupport className="h-6 w-6" />
          {nonLus > 0 && (
            <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-bold flex items-center justify-center">
              {nonLus}
            </span>
          )}
        </button>
      )}

      {/* Fenetre */}
      {ouvert && (
        <div
          className="fixed z-50 inset-x-3 bottom-3 sm:inset-x-auto sm:left-5 sm:bottom-5 sm:w-[384px] flex flex-col rounded-2xl bg-white shadow-2xl border border-border overflow-hidden animate-scale-in"
          style={{ height: 'min(78vh, 600px)', marginBottom: 'env(safe-area-inset-bottom)' }}
          role="dialog"
          aria-label="Demander à Julien"
        >
          {/* En-tete */}
          <div className="flex items-center gap-3 bg-header text-white px-4 py-3">
            <div className="h-9 w-9 rounded-full bg-white/10 flex items-center justify-center shrink-0">
              <IconeSupport className="h-5 w-5" />
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
                Une question, un souci ou une idée d&apos;amélioration ? Écris-le ici : Julien est
                notifié tout de suite et te répond directement dans l&apos;app.
              </p>
              <textarea
                value={saisie}
                onChange={(e) => setSaisie(e.target.value)}
                placeholder="Décris ta question ou ton problème…"
                className="flex-1 min-h-0 w-full resize-none rounded-xl bg-input-bg border border-border focus:border-primary focus:bg-input-focus outline-none px-3.5 py-3 text-sm leading-relaxed"
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
                    Pose ta première question à Julien depuis l&apos;onglet « Nouveau message ».
                  </p>
                </div>
              ) : (
                tickets.map((t) => <CarteTicket key={t.id} ticket={t} />)
              )}
            </div>
          )}
        </div>
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

function IconeSupport({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}
