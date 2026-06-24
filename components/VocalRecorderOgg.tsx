'use client'

// =============================================================
// Enregistreur vocal OGG/OPUS (pour un vrai message vocal Telegram)
// =============================================================
// Telegram n'affiche une bulle vocale native (sendVoice + waveform + lecture) que
// pour de l'OGG/OPUS. Les navigateurs n'enregistrent pas l'OGG nativement (sauf
// Firefox), d'où opus-recorder (encodeur WASM) qui produit directement de l'OGG.
//
// Repli : si opus-recorder échoue (vieux navigateur, WASM/worklet indisponible),
// on bascule sur MediaRecorder (webm) — la dictée marche quand même, le vocal part
// alors en fichier (sendDocument) plutôt qu'en bulle. L'enregistrement ne casse
// jamais. Mêmes props et même rendu compact que components/AudioRecorder.tsx.

import { useCallback, useEffect, useRef, useState } from 'react'

const DUREE_MAX_S = 300
const ENCODER_PATH = '/opus/encoderWorker.min.js'

interface Props {
  onRecordingComplete: (blob: Blob) => void
  onError?: (message: string) => void
  disabled?: boolean
}

// opus-recorder n'a pas de types fournis : forme minimale de ce qu'on utilise.
interface OpusRecorderLike {
  ondataavailable: (data: Uint8Array) => void
  onstop: () => void
  start: () => Promise<void>
  stop: () => void
}

export default function VocalRecorderOgg({ onRecordingComplete, onError, disabled }: Props) {
  const [recording, setRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const opusRef = useRef<OpusRecorderLike | null>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const finir = useCallback(
    (blob: Blob) => {
      if (blob.size > 0) onRecordingComplete(blob)
    },
    [onRecordingComplete],
  )

  const arreterTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Repli MediaRecorder (webm) si opus-recorder indisponible.
  const demarrerMedia = useCallback(
    async (stream: MediaStream) => {
      streamRef.current = stream
      const mr = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      })
      mediaRef.current = mr
      chunksRef.current = []
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      mr.onstop = () => {
        finir(new Blob(chunksRef.current, { type: 'audio/webm' }))
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
      mr.start()
    },
    [finir],
  )

  const startRecording = useCallback(async () => {
    setDuration(0)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // 1) Tentative OGG/OPUS via opus-recorder (import dynamique : pas d'éval SSR).
      try {
        const mod = (await import('opus-recorder')) as unknown as {
          default: new (opts: Record<string, unknown>) => OpusRecorderLike
        }
        const Recorder = mod.default
        const rec = new Recorder({
          encoderPath: ENCODER_PATH,
          numberOfChannels: 1,
          encoderApplication: 2048, // VOIP (voix)
          encoderSampleRate: 48000,
          // streamPages: false (défaut) -> ondataavailable une fois avec l'OGG complet
        })
        const pages: Uint8Array[] = []
        rec.ondataavailable = (data) => pages.push(data)
        rec.onstop = () => {
          finir(new Blob(pages as unknown as BlobPart[], { type: 'audio/ogg' }))
          stream.getTracks().forEach((t) => t.stop())
          streamRef.current = null
        }
        streamRef.current = stream
        opusRef.current = rec
        await rec.start()
      } catch {
        // Repli MediaRecorder si opus échoue (init/worker/worklet).
        opusRef.current = null
        await demarrerMedia(stream)
      }
      setRecording(true)
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000)
    } catch {
      onError?.("Micro indisponible. Vérifiez l'autorisation du navigateur.")
    }
  }, [finir, demarrerMedia, onError])

  const stopRecording = useCallback(() => {
    arreterTimer()
    setRecording(false)
    setDuration(0)
    try {
      if (opusRef.current) {
        opusRef.current.stop()
        opusRef.current = null
        return
      }
      if (mediaRef.current && mediaRef.current.state === 'recording') {
        mediaRef.current.stop()
      }
    } catch {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [arreterTimer])

  // Arrêt automatique à la durée max.
  useEffect(() => {
    if (recording && duration >= DUREE_MAX_S) stopRecording()
  }, [recording, duration, stopRecording])

  // Nettoyage au démontage.
  useEffect(() => {
    return () => {
      arreterTimer()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [arreterTimer])

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

  if (recording) {
    return (
      <button
        type="button"
        onClick={stopRecording}
        aria-label={`Arrêter l'enregistrement (${fmt(duration)})`}
        title={`Arrêter l'enregistrement (${fmt(duration)})`}
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
      aria-label="Dicter votre message"
      title="Dicter votre message"
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
