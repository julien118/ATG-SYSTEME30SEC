'use client'

// =============================================================
// "Demander à Julien" — support en fils de discussion (bouton « ? » en-tête)
// =============================================================
// Bouton « ? » dans la barre noire. Au clic, panneau déroulant avec :
//   - Nouveau message : Olivier ouvre une demande (texte ou dictée).
//   - Mes demandes : cartes compactes (titre court généré par l'IA) groupées par
//     thématique ; section « Résolues » repliée en bas. Clic sur une carte ->
//     vue conversation : tout l'échange + réponse (texte/vocal) + « Marquer résolu ».
// Julien répond depuis Telegram (texte ou vocal transcrit) ; chaque côté peut
// clôturer. Tout reste archivé et consultable.

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useToast } from './ToastProvider'
import VocalRecorderOgg from './VocalRecorderOgg'
import { CATEGORIES, normaliserCategorie } from '@/lib/ticket-categories'
import type { TicketResume, TicketDetail } from '@/lib/types'

const fmtDate = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
function formaterDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return fmtDate.format(new Date(iso))
  } catch {
    return ''
  }
}

// Titre affiché dans l'onglet du navigateur quand tout est lu (= metadata.title
// défini dans app/layout.tsx). Sert de valeur de restauration.
const TITRE_ONGLET_BASE = 'ATG — Système 30 Secondes'

// Pastille rouge sur le favicon (best-effort). Dessine un point rouge par-dessus
// le favicon existant via un canvas ; restaure l'original quand actif=false.
// Toute erreur (navigateur récalcitrant, iOS Safari en PWA…) est avalée : le
// titre de l'onglet reste, lui, le signal fiable partout.
let faviconOriginal: string | null = null
function appliquerFavicon(actif: boolean) {
  if (typeof document === 'undefined') return
  try {
    const link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
    if (!link) return
    if (faviconOriginal === null) faviconOriginal = link.href

    if (!actif) {
      if (faviconOriginal) link.href = faviconOriginal
      return
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const taille = 32
        const canvas = document.createElement('canvas')
        canvas.width = taille
        canvas.height = taille
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0, taille, taille)
        const r = 8
        ctx.beginPath()
        ctx.arc(taille - r, r, r, 0, Math.PI * 2)
        ctx.fillStyle = '#DC2626'
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = '#FFFFFF'
        ctx.stroke()
        link.href = canvas.toDataURL('image/png')
      } catch {
        // navigateur récalcitrant : on garde le favicon d'origine, tant pis.
      }
    }
    img.src = faviconOriginal || '/favicon-32.png'
  } catch {
    // no-op : le titre d'onglet suffit.
  }
}

export default function AssistantTicket({ className = '' }: { className?: string }) {
  const pathname = usePathname()
  const toast = useToast()
  const [ouvert, setOuvert] = useState(false)
  const [vue, setVue] = useState<'nouveau' | 'liste' | 'conversation'>('nouveau')
  const [resumes, setResumes] = useState<TicketResume[]>([])
  const [nonLus, setNonLus] = useState(0)
  const [chargement, setChargement] = useState(false)
  const [resoluesOuvert, setResoluesOuvert] = useState(false)
  // Conversation ouverte
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TicketDetail | null>(null)
  const [chargementDetail, setChargementDetail] = useState(false)
  const [erreurDetail, setErreurDetail] = useState(false)
  const finRef = useRef<HTMLDivElement>(null)

  const rafraichirListe = useCallback(async () => {
    try {
      const res = await fetch('/api/tickets', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      setResumes(Array.isArray(data.tickets) ? data.tickets : [])
      setNonLus(typeof data.nonLus === 'number' ? data.nonLus : 0)
    } catch {
      // silencieux
    }
  }, [])

  // Liste : au montage + rafraîchissement tant que le widget est ouvert.
  useEffect(() => {
    setChargement(true)
    rafraichirListe().finally(() => setChargement(false))
    if (!ouvert) return
    const id = setInterval(rafraichirListe, 30000)
    return () => clearInterval(id)
  }, [ouvert, rafraichirListe])

  const chargerDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/tickets/${id}`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ticket) {
        setDetail(data.ticket as TicketDetail)
        setErreurDetail(false)
      } else {
        setErreurDetail(true)
      }
    } catch {
      setErreurDetail(true)
    }
  }, [])

  // Rafraîchit dès qu'on revient sur l'app (ex. retour de Telegram) : la réponse
  // apparaît immédiatement, sans attendre le prochain poll. Met aussi à jour la
  // pastille « ? » même widget fermé.
  useEffect(() => {
    function onRetour() {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      rafraichirListe()
      if (vue === 'conversation' && selectedId) chargerDetail(selectedId)
    }
    window.addEventListener('focus', onRetour)
    document.addEventListener('visibilitychange', onRetour)
    return () => {
      window.removeEventListener('focus', onRetour)
      document.removeEventListener('visibilitychange', onRetour)
    }
  }, [vue, selectedId, rafraichirListe, chargerDetail])

  // Ouverture d'une conversation : charge le fil + marque ce fil lu + poll léger.
  useEffect(() => {
    if (vue !== 'conversation' || !selectedId) return
    setErreurDetail(false)
    setChargementDetail(true)
    chargerDetail(selectedId).finally(() => setChargementDetail(false))
    // Marque CE fil lu (optimiste + serveur).
    setNonLus((n) => Math.max(0, n - (resumes.find((r) => r.id === selectedId && !r.lu_par_olivier) ? 1 : 0)))
    fetch('/api/tickets/lu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selectedId }),
    }).catch(() => {})
    const t = setInterval(() => chargerDetail(selectedId), 10000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vue, selectedId, chargerDetail])

  // Défile en bas du fil à chaque mise à jour.
  useEffect(() => {
    if (vue === 'conversation') finRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [detail, vue])

  // Alerte dans l'onglet du navigateur : quand Julien a répondu (nonLus > 0), le
  // titre de l'onglet devient une notification visible même depuis un autre onglet
  // ou une autre appli ; on restaure le titre normal dès qu'Olivier a lu. Pastille
  // rouge sur le favicon en complément (best-effort). Ne modifie aucune donnée.
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.title = nonLus > 0 ? `(${nonLus}) 💬 Julien a répondu` : TITRE_ONGLET_BASE
    appliquerFavicon(nonLus > 0)
  }, [nonLus])

  function capturerContexte() {
    const m = pathname.match(/\/chantiers\/([0-9a-f-]{36})/i)
    return {
      path: pathname,
      chantierId: m?.[1],
      viewport: typeof window !== 'undefined' ? `${window.innerWidth}×${window.innerHeight}` : undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : undefined,
    }
  }

  // Création d'une demande -> ouvre la conversation du nouveau fil.
  async function creer(message: string, audio: Blob | null): Promise<boolean> {
    try {
      let res: Response
      if (audio) {
        const fd = new FormData()
        fd.append('message', message)
        fd.append('contexte', JSON.stringify(capturerContexte()))
        fd.append('audio', audio, audio.type.includes('ogg') ? 'message-vocal.ogg' : 'message-vocal.webm')
        res = await fetch('/api/tickets', { method: 'POST', body: fd })
      } else {
        res = await fetch('/api/tickets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, contexte: capturerContexte() }),
        })
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.show('Envoi impossible, réessayez.', 'error')
        return false
      }
      toast.show(
        data.notifEnvoyee === false ? 'Message enregistré, il sera transmis à Julien.' : 'Message envoyé à Julien',
        data.notifEnvoyee === false ? 'info' : 'success',
      )
      await rafraichirListe()
      if (data.id) {
        setSelectedId(data.id)
        setDetail(null)
        setVue('conversation')
      } else {
        setVue('liste')
      }
      return true
    } catch {
      toast.show('Envoi impossible, vérifiez la connexion.', 'error')
      return false
    }
  }

  // Réponse d'Olivier dans le fil ouvert.
  async function repondre(message: string, audio: Blob | null): Promise<boolean> {
    if (!selectedId) return false
    try {
      let res: Response
      if (audio) {
        const fd = new FormData()
        fd.append('message', message)
        fd.append('audio', audio, audio.type.includes('ogg') ? 'message-vocal.ogg' : 'message-vocal.webm')
        res = await fetch(`/api/tickets/${selectedId}/messages`, { method: 'POST', body: fd })
      } else {
        res = await fetch(`/api/tickets/${selectedId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        })
      }
      if (!res.ok) {
        toast.show('Envoi impossible, réessayez.', 'error')
        return false
      }
      await chargerDetail(selectedId)
      await rafraichirListe()
      return true
    } catch {
      toast.show('Envoi impossible, vérifiez la connexion.', 'error')
      return false
    }
  }

  async function marquerResolu() {
    if (!selectedId) return
    try {
      await fetch(`/api/tickets/${selectedId}/resolu`, { method: 'POST' })
      toast.show('Demande marquée comme résolue', 'success')
      await chargerDetail(selectedId)
      await rafraichirListe()
    } catch {
      toast.show('Action impossible, réessayez.', 'error')
    }
  }

  const actifs = resumes.filter((r) => r.statut !== 'resolu')
  const resolues = resumes.filter((r) => r.statut === 'resolu')

  function ouvrirConversation(id: string) {
    setSelectedId(id)
    setDetail(null)
    setVue('conversation')
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

      {/* Bandeau d'alerte : glisse sous le header quand Julien a répondu et que le
          panneau est fermé. Clic -> ouvre « Mes demandes ». Disparaît tout seul
          dès qu'Olivier a lu (nonLus retombe à 0). Purement visuel. */}
      {nonLus > 0 && !ouvert && (
        <button
          onClick={() => {
            setVue('liste')
            setOuvert(true)
          }}
          aria-label="Julien vous a répondu — voir la réponse"
          className="fixed left-2 right-2 sm:left-auto sm:right-3 sm:w-[380px] z-30 flex items-center gap-3 rounded-2xl bg-primary text-white px-4 py-3 shadow-2xl animate-slide-down active:scale-[0.99] transition-transform"
          style={{ top: 'calc(env(safe-area-inset-top) + 4.25rem)' }}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-lg">💬</span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-sm font-semibold leading-tight">Julien vous a répondu</span>
            <span className="block text-xs text-white/80 leading-tight">
              {nonLus > 1 ? `${nonLus} demandes en attente` : 'Touchez pour voir la réponse'}
            </span>
          </span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/90">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {ouvert && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOuvert(false)} aria-hidden />
          <div
            className="fixed z-50 right-2 left-2 sm:left-auto sm:right-3 sm:w-[400px] flex flex-col rounded-2xl bg-white shadow-2xl border border-border overflow-hidden animate-scale-in"
            style={{ top: 'calc(env(safe-area-inset-top) + 4rem)', maxHeight: '80vh' }}
            role="dialog"
            aria-label="Demander à Julien"
          >
            {/* En-tête */}
            <div className="flex items-center gap-3 bg-header text-white px-4 py-3">
              <div className="h-9 w-9 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                <IconeAide className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight">Demander à Julien</p>
                <p className="text-xs text-white/60 leading-tight">Question, souci ou idée</p>
              </div>
              <button onClick={() => setOuvert(false)} aria-label="Fermer" className="text-white/70 hover:text-white p-1">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Onglets (cachés en vue conversation) */}
            {vue !== 'conversation' && (
              <div className="flex border-b border-border bg-white shrink-0">
                <Onglet actif={vue === 'nouveau'} onClick={() => setVue('nouveau')}>
                  Nouveau message
                </Onglet>
                <Onglet actif={vue === 'liste'} onClick={() => setVue('liste')}>
                  <span className="inline-flex items-center gap-1">
                    Mes demandes
                    {nonLus > 0 && <span className="font-bold text-red-600">({nonLus})</span>}
                  </span>
                </Onglet>
              </div>
            )}

            {/* NOUVEAU */}
            {vue === 'nouveau' && (
              <div className="flex-1 min-h-0 flex flex-col px-4 py-4 bg-background">
                <p className="text-sm text-gray-600 mb-3">
                  Une question, un souci ou une idée d&apos;amélioration ? Écrivez-le ici (ou
                  dictez-le 🎤) : Julien est notifié tout de suite et vous répond directement ici,
                  dans « Mes demandes ».
                </p>
                <Composer
                  onSend={creer}
                  placeholder="Décrivez votre question ou votre problème…"
                  bouton="Envoyer à Julien"
                  multiline
                />
              </div>
            )}

            {/* LISTE (cartes par thématique + résolues) */}
            {vue === 'liste' && (
              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4 bg-background">
                {chargement && resumes.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center pt-8">Chargement…</p>
                ) : resumes.length === 0 ? (
                  <div className="text-center pt-8 px-4">
                    <p className="text-sm text-gray-500">Aucune demande pour l&apos;instant.</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Posez votre première question depuis l&apos;onglet « Nouveau message ».
                    </p>
                  </div>
                ) : (
                  <>
                    {CATEGORIES.map((cat) => {
                      const items = actifs.filter((r) => normaliserCategorie(r.categorie) === cat.cle)
                      if (items.length === 0) return null
                      return (
                        <div key={cat.cle} className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                            {cat.emoji} {cat.label}
                            <span className="text-gray-300"> · {items.length}</span>
                          </p>
                          {items.map((r) => (
                            <Carte key={r.id} r={r} onClick={() => ouvrirConversation(r.id)} />
                          ))}
                        </div>
                      )
                    })}

                    {resolues.length > 0 && (
                      <div className="pt-1">
                        <button
                          onClick={() => setResoluesOuvert((v) => !v)}
                          className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-400 py-1"
                        >
                          <span>✓ Résolues · {resolues.length}</span>
                          <svg
                            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                            className={`transition-transform ${resoluesOuvert ? 'rotate-180' : ''}`}
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                        {resoluesOuvert && (
                          <div className="space-y-2 mt-2">
                            {resolues.map((r) => (
                              <Carte key={r.id} r={r} onClick={() => ouvrirConversation(r.id)} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* CONVERSATION */}
            {vue === 'conversation' && (
              <div className="flex-1 min-h-0 flex flex-col bg-background">
                {/* Barre du fil */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-white shrink-0">
                  <button
                    onClick={() => {
                      setVue('liste')
                      setSelectedId(null)
                      setDetail(null)
                    }}
                    aria-label="Retour"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <p className="min-w-0 flex-1 text-sm font-semibold text-foreground truncate">
                    {detail?.titre?.trim() || 'Discussion'}
                  </p>
                  {detail && detail.statut === 'resolu' ? (
                    <span className="shrink-0 text-[11px] font-medium text-green-700 bg-green-50 rounded-full px-2 py-0.5">
                      Résolu ✓
                    </span>
                  ) : (
                    detail && (
                      <button
                        onClick={marquerResolu}
                        className="shrink-0 text-[11px] font-medium text-primary-dark bg-primary/10 hover:bg-primary/20 rounded-full px-2 py-1 transition"
                      >
                        Marquer résolu
                      </button>
                    )
                  )}
                </div>

                {/* Messages */}
                <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-3">
                  {chargementDetail && !detail ? (
                    <p className="text-sm text-gray-400 text-center pt-8">Chargement…</p>
                  ) : erreurDetail && !detail ? (
                    <div className="text-center pt-8">
                      <p className="text-sm text-gray-500">Impossible de charger la discussion.</p>
                      <button
                        onClick={() => selectedId && chargerDetail(selectedId)}
                        className="text-xs font-medium text-primary mt-1 hover:underline"
                      >
                        Réessayer
                      </button>
                    </div>
                  ) : (
                    (detail?.messages ?? []).map((m) => (
                      <div key={m.id} className="space-y-1">
                        <div className={`flex ${m.auteur === 'olivier' ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[85%] px-3.5 py-2.5 text-sm leading-relaxed shadow-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${
                              m.auteur === 'olivier'
                                ? 'bg-primary text-white rounded-2xl rounded-br-md'
                                : 'bg-white text-foreground border border-border rounded-2xl rounded-bl-md'
                            }`}
                          >
                            <MessageContenu texte={m.texte} sombre={m.auteur === 'olivier'} />
                          </div>
                        </div>
                        <p className={`text-[11px] text-gray-400 ${m.auteur === 'olivier' ? 'text-right pr-1' : 'pl-1'}`}>
                          {m.auteur === 'olivier' ? 'Vous' : 'Julien'} · {formaterDate(m.created_at)}
                        </p>
                      </div>
                    ))
                  )}
                  <div ref={finRef} />
                </div>

                {/* Réponse */}
                <div className="border-t border-border bg-white px-3 py-2.5 shrink-0">
                  <Composer
                    onSend={repondre}
                    placeholder={
                      detail?.statut === 'resolu' ? 'Répondre rouvre la discussion…' : 'Votre réponse…'
                    }
                    bouton="Répondre"
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}

// ---------- Composer réutilisable (texte + dictée OGG) ----------

function Composer({
  onSend,
  placeholder,
  bouton,
  multiline,
}: {
  onSend: (message: string, audio: Blob | null) => Promise<boolean>
  placeholder: string
  bouton: string
  multiline?: boolean
}) {
  const [saisie, setSaisie] = useState('')
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [transcription, setTranscription] = useState(false)
  const [erreurVocal, setErreurVocal] = useState('')
  const [envoi, setEnvoi] = useState(false)

  async function transcrire(blob: Blob) {
    if (blob.size < 1000) {
      setErreurVocal('Enregistrement trop court.')
      return
    }
    setErreurVocal('')
    setAudioBlob(blob)
    setTranscription(true)
    try {
      const fd = new FormData()
      fd.append('audio', blob, blob.type.includes('ogg') ? 'message.ogg' : 'message.webm')
      const res = await fetch('/api/transcribe?mode=support', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      const texte = (data.text ?? '').trim()
      if (res.ok && texte) {
        setSaisie((prev) => (prev.trim() ? `${prev.trim()} ${texte}` : texte))
      } else {
        setErreurVocal('Transcription indisponible — le vocal sera quand même envoyé à Julien.')
      }
    } catch {
      setErreurVocal('Transcription indisponible — le vocal sera quand même envoyé à Julien.')
    } finally {
      setTranscription(false)
    }
  }

  async function envoyer() {
    const message = saisie.trim()
    if ((!message && !audioBlob) || envoi || transcription) return
    setEnvoi(true)
    const ok = await onSend(message, audioBlob)
    setEnvoi(false)
    if (ok) {
      setSaisie('')
      setAudioBlob(null)
      setErreurVocal('')
    }
  }

  return (
    <div className={multiline ? 'flex-1 min-h-0 flex flex-col' : ''}>
      <textarea
        value={saisie}
        onChange={(e) => setSaisie(e.target.value)}
        placeholder={transcription ? 'Transcription en cours…' : placeholder}
        rows={multiline ? undefined : 2}
        className={`${multiline ? 'flex-1 min-h-[120px]' : 'min-h-[44px]'} w-full resize-none rounded-xl bg-input-bg border border-border focus:border-primary focus:bg-input-focus outline-none px-3.5 py-2.5 text-sm leading-relaxed`}
      />
      <div className="mt-2 flex items-center gap-2">
        <VocalRecorderOgg onRecordingComplete={transcrire} onError={setErreurVocal} disabled={envoi || transcription} />
        <span className="text-xs text-gray-500 min-w-0 truncate">
          {transcription ? 'Transcription en cours…' : audioBlob ? '🎤 Vocal joint' : 'Ou dictez'}
        </span>
        {audioBlob && !transcription && (
          <button type="button" onClick={() => setAudioBlob(null)} className="shrink-0 text-xs font-medium text-red-600 hover:underline">
            Retirer
          </button>
        )}
        <button
          onClick={envoyer}
          disabled={(!saisie.trim() && !audioBlob) || envoi || transcription}
          className="ml-auto shrink-0 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-200 disabled:text-gray-400 enabled:hover:bg-primary-dark enabled:active:scale-95 transition-colors"
        >
          {envoi ? 'Envoi…' : bouton}
        </button>
      </div>
      {erreurVocal && (
        <p className="text-xs text-amber-600 mt-1" role="status">
          {erreurVocal}
        </p>
      )}
    </div>
  )
}

// ---------- Rendu du contenu d'un message (liens + miniatures Loom) ----------

// Découpe un texte en segments : liens Loom (miniature cliquable), autres URL
// (lien cliquable qui va à la ligne au lieu de déborder), et texte simple.
// Un lien Loom ressemble à https://www.loom.com/share/<id 20+ hex>[?params].
const RE_URL = /https?:\/\/[^\s]+/g
const RE_LOOM = /^https?:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/([a-f0-9]{20,})/i

function loomId(url: string): string | null {
  const m = url.match(RE_LOOM)
  return m ? m[1] : null
}

function MessageContenu({ texte, sombre }: { texte: string; sombre: boolean }) {
  const segments: React.ReactNode[] = []
  let dernier = 0
  let i = 0
  // Réinitialise l'état du regex global entre deux rendus.
  RE_URL.lastIndex = 0
  for (const m of Array.from(texte.matchAll(RE_URL))) {
    const url = m[0]
    const debut = m.index ?? 0
    if (debut > dernier) segments.push(texte.slice(dernier, debut))
    const id = loomId(url)
    if (id) {
      segments.push(<LoomMiniature key={`loom-${i}`} id={id} url={url} />)
    } else {
      segments.push(
        <a
          key={`url-${i}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={`underline underline-offset-2 break-all ${sombre ? 'text-white/90' : 'text-primary'}`}
        >
          {url}
        </a>,
      )
    }
    dernier = debut + url.length
    i++
  }
  if (dernier < texte.length) segments.push(texte.slice(dernier))
  return <>{segments}</>
}

// Miniature Loom cliquable : image de prévisualisation (avec pastille lecture)
// servie par le CDN Loom, qui ouvre la vidéo dans un nouvel onglet au clic.
function LoomMiniature({ id, url }: { id: string; url: string }) {
  const [erreur, setErreur] = useState(false)
  if (erreur) {
    // Fallback si la miniature ne charge pas : un bouton lecture clair, jamais une URL nue.
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="my-1 flex items-center gap-2 rounded-xl bg-black/80 px-3 py-2 text-white no-underline"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20">▶</span>
        <span className="text-sm font-medium">Voir la vidéo Loom</span>
      </a>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Voir la vidéo Loom"
      className="my-1 block max-w-full overflow-hidden rounded-xl bg-black/90 no-underline"
    >
      <span className="relative block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://cdn.loom.com/sessions/thumbnails/${id}-with-play.jpg`}
          alt="Vidéo Loom — cliquer pour lire"
          className="block h-auto w-full max-w-[280px]"
          loading="lazy"
          onError={() => setErreur(true)}
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-xl text-white shadow-lg backdrop-blur-sm">
            ▶
          </span>
        </span>
      </span>
    </a>
  )
}

// ---------- Sous-composants ----------

function Onglet({ actif, onClick, children }: { actif: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-2.5 text-sm font-medium transition-colors ${
        actif ? 'text-primary border-b-2 border-primary' : 'text-gray-500 border-b-2 border-transparent hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

function Carte({ r, onClick }: { r: TicketResume; onClick: () => void }) {
  const nonLu = !r.lu_par_olivier
  const sousTitre =
    r.statut === 'resolu'
      ? 'Résolu'
      : nonLu && r.dernier_auteur === 'julien'
        ? 'Julien a répondu'
        : `${r.nb_messages} message${r.nb_messages > 1 ? 's' : ''}`
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-white px-3.5 py-3 hover:border-primary/40 active:scale-[0.99] transition flex items-center gap-2.5"
    >
      <div className="min-w-0 flex-1">
        <p className={`text-sm truncate ${nonLu ? 'font-semibold text-foreground' : 'font-medium text-foreground'}`}>
          {r.apercu || 'Demande'}
        </p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {sousTitre}
          {r.derniere_activite_le ? ` · ${formaterDate(r.derniere_activite_le)}` : ''}
        </p>
      </div>
      {nonLu && <span className="h-2.5 w-2.5 rounded-full bg-red-600 shrink-0" />}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-300 shrink-0">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
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
