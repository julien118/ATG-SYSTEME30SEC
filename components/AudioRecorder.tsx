'use client'

import { useState, useRef, useCallback } from 'react'

interface AudioRecorderProps {
  onRecordingComplete: (blob: Blob) => void
  disabled?: boolean
  describeMode?: boolean
  // 'default' : gros bouton pleine largeur (barre d'actions de la visite).
  // 'compact' : petite icone micro ronde pour une ligne de saisie (chat assistant).
  // La mecanique d'enregistrement est strictement identique dans les deux cas.
  variant?: 'default' | 'compact'
  // Notifie l'appelant si le micro est refuse ou indisponible (message discret).
  // Optionnel : la visite ne le passe pas, son comportement reste inchange.
  onError?: (message: string) => void
}

export default function AudioRecorder({
  onRecordingComplete,
  disabled,
  describeMode,
  variant = 'default',
  onError,
}: AudioRecorderProps) {
  const [recording, setRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      })
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        onRecordingComplete(blob)
        stream.getTracks().forEach((t) => t.stop())
      }

      mediaRecorder.start()
      setRecording(true)
      setDuration(0)
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000)
    } catch {
      // Permission refusee ou pas de micro : on previent l'appelant si demande.
      onError?.('Micro indisponible. Vérifiez l\'autorisation du navigateur.')
    }
  }, [onRecordingComplete, onError])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setRecording(false)
    setDuration(0)
  }, [])

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  // Variante compacte : icone micro ronde calee sur la taille du bouton "envoyer"
  // du chat (h-10 w-10). En enregistrement, carre rouge pulsant ; la duree est
  // portee par l'aria-label/title faute de place pour un libelle.
  if (variant === 'compact') {
    if (recording) {
      return (
        <button
          type="button"
          onClick={stopRecording}
          aria-label={`Arrêter l'enregistrement (${formatDuration(duration)})`}
          title={`Arrêter l'enregistrement (${formatDuration(duration)})`}
          className="h-10 w-10 shrink-0 rounded-full bg-red-600 text-white flex items-center justify-center transition active:scale-95 animate-pulse-record"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      )
    }
    return (
      <button
        type="button"
        onClick={startRecording}
        disabled={disabled}
        aria-label="Dicter votre question"
        title="Dicter votre question"
        className="h-10 w-10 shrink-0 rounded-full bg-input-bg border border-border text-foreground flex items-center justify-center transition active:scale-95 disabled:opacity-40 enabled:hover:border-primary/30"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </button>
    )
  }

  if (recording) {
    return (
      <button
        onClick={stopRecording}
        className="flex-1 flex items-center justify-center gap-2 py-3 bg-red-600 rounded-xl font-medium text-white transition-all active:scale-[0.97] animate-pulse-record"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
        {formatDuration(duration)} — Arrêter
      </button>
    )
  }

  return (
    <button
      onClick={startRecording}
      disabled={disabled}
      className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition-all active:scale-[0.97] disabled:opacity-50 ${
        describeMode
          ? 'bg-gradient-to-r from-primary to-primary-dark text-white shadow-md'
          : 'bg-white border border-border text-foreground hover:border-primary/30'
      }`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
      {describeMode ? 'Décrire cette photo' : 'Vocal'}
    </button>
  )
}
