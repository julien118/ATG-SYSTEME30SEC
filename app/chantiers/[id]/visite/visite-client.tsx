'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { compressImage, uploadWithRetry, fetchWithTimeout } from '@/lib/utils'
import { useToast } from '@/components/ToastProvider'
import PhotoCapture from '@/components/PhotoCapture'
import AudioRecorder from '@/components/AudioRecorder'
import CaptureItemComponent from '@/components/CaptureItem'
import type { Chantier, CaptureItem, Profile } from '@/lib/types'

interface VisiteClientProps {
  chantier: Chantier
  initialCaptures: CaptureItem[]
  profile: Profile
  userId: string
}

export default function VisiteClient({ chantier, initialCaptures, profile, userId }: VisiteClientProps) {
  const router = useRouter()
  const supabase = createClient()

  const [captures, setCaptures] = useState<CaptureItem[]>(initialCaptures)
  const [describeMode, setDescribeMode] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [showEndModal, setShowEndModal] = useState(false)
  const [uploading, setUploading] = useState(false)
  const toast = useToast()

  const timelineRef = useRef<HTMLDivElement>(null)
  const userScrolledRef = useRef(false)
  const lastPhotoRef = useRef<{ id: string; position: number; timestamp: number } | null>(null)
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const nextPosition = captures.length > 0 ? Math.max(...captures.map((c) => c.position)) + 1 : 1

  // Counters
  const photoCount = captures.filter((c) => c.type === 'photo').length
  const vocalCount = captures.filter((c) => c.type === 'vocal').length

  // Auto-scroll
  const scrollToBottom = useCallback(() => {
    if (!userScrolledRef.current && timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [captures, scrollToBottom])

  const handleTimelineScroll = () => {
    if (!timelineRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = timelineRef.current
    userScrolledRef.current = scrollHeight - scrollTop - clientHeight > 100
  }

  // ---- PHOTO FLOW ----
  const handlePhotoTaken = useCallback(async (file: File) => {
    setUploading(true)
    try {
      const compressed = await compressImage(file)
      const timestamp = Date.now()
      const path = `${userId}/${chantier.id}/${timestamp}.jpg`

      await uploadWithRetry(async () => {
        return await supabase.storage.from('photos').upload(path, compressed, {
          contentType: 'image/jpeg',
        })
      })

      const { data: urlData } = supabase.storage.from('photos').getPublicUrl(path)
      const photoUrl = urlData.publicUrl

      const position = nextPosition
      const { data: inserted } = await supabase
        .from('capture_items')
        .insert({
          chantier_id: chantier.id,
          type: 'photo',
          position,
          photo_url: photoUrl,
        })
        .select()
        .single()

      if (inserted) {
        setCaptures((prev) => [...prev, inserted as CaptureItem])
        lastPhotoRef.current = { id: inserted.id, position, timestamp: Date.now() }
        toast.show('Photo ajoutée', 'success')

        // Start 10s countdown for describe mode
        setDescribeMode(true)
        setCountdown(10)
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current)
        countdownTimerRef.current = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= 1) {
              clearInterval(countdownTimerRef.current!)
              countdownTimerRef.current = null
              setDescribeMode(false)
              return 0
            }
            return prev - 1
          })
        }, 1000)
      }
    } catch (err) {
      toast.show('Erreur lors de l\'upload photo', 'error')
    }
    setUploading(false)
  }, [userId, chantier.id, nextPosition, supabase, toast])

  // ---- AUDIO FLOW ----
  const handleRecordingComplete = useCallback(async (blob: Blob) => {
    setUploading(true)
    try {
      const timestamp = Date.now()
      const path = `${userId}/${chantier.id}/${timestamp}.webm`

      await uploadWithRetry(async () => {
        return await supabase.storage.from('audio').upload(path, blob, {
          contentType: 'audio/webm',
        })
      })

      const { data: signedData } = await supabase.storage
        .from('audio')
        .createSignedUrl(path, 365 * 24 * 60 * 60) // 1 year

      // Should link to photo?
      let linkedPhotoId: string | null = null
      if (lastPhotoRef.current) {
        const timeSincePhoto = Date.now() - lastPhotoRef.current.timestamp
        if (describeMode || timeSincePhoto < 30000) {
          linkedPhotoId = lastPhotoRef.current.id
        }
      }

      const position = nextPosition
      const { data: inserted } = await supabase
        .from('capture_items')
        .insert({
          chantier_id: chantier.id,
          type: 'vocal',
          position,
          audio_url: signedData?.signedUrl ?? null,
          linked_photo_id: linkedPhotoId,
        })
        .select()
        .single()

      if (inserted) {
        setCaptures((prev) => [...prev, inserted as CaptureItem])

        // Reset describe mode
        if (describeMode) {
          setDescribeMode(false)
          setCountdown(0)
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current)
            countdownTimerRef.current = null
          }
        }

        // Transcribe
        const formData = new FormData()
        formData.append('audio', blob, 'recording.webm')
        try {
          const res = await fetchWithTimeout('/api/transcribe', { method: 'POST', body: formData }, 20000)
          const { text } = await res.json()

          if (text) {
            await supabase
              .from('capture_items')
              .update({ transcription: text })
              .eq('id', inserted.id)

            setCaptures((prev) =>
              prev.map((c) => (c.id === inserted.id ? { ...c, transcription: text } : c))
            )
            toast.show('Transcription terminée', 'success')
          }
        } catch {
          toast.show('Transcription échouée', 'error')
        }
      }
    } catch (err) {
      toast.show('Erreur lors de l\'upload audio', 'error')
    }
    setUploading(false)
  }, [userId, chantier.id, nextPosition, supabase, describeMode, toast])

  // ---- DELETE ----
  const handleDelete = useCallback(async (itemId: string, linkedId?: string | null) => {
    const idsToDelete = [itemId, ...(linkedId ? [linkedId] : [])]
    await Promise.all(
      idsToDelete.map((id) => supabase.from('capture_items').delete().eq('id', id))
    )
    setCaptures((prev) => prev.filter((c) => !idsToDelete.includes(c.id)))
  }, [supabase])

  // ---- EDIT TRANSCRIPTION ----
  const handleEditTranscription = useCallback(async (itemId: string, text: string) => {
    await supabase.from('capture_items').update({ transcription: text }).eq('id', itemId)
    setCaptures((prev) =>
      prev.map((c) => (c.id === itemId ? { ...c, transcription: text } : c))
    )
  }, [supabase])

  // ---- END VISIT ----
  const handleEndVisit = async () => {
    // Check trial limit
    if (profile.rapports_generes >= 2) {
      router.push('/essai-termine')
      return
    }

    await supabase
      .from('chantiers')
      .update({ statut: 'termine' })
      .eq('id', chantier.id)

    router.push(`/chantiers/${chantier.id}/rapport`)
  }

  // ---- BUILD TIMELINE ----
  // Group: photo + linked vocal merged, linked vocals hidden from main list
  const linkedVocalIds = new Set(
    captures.filter((c) => c.linked_photo_id).map((c) => c.id)
  )

  const timelineItems = captures.filter((c) => !linkedVocalIds.has(c.id))

  const getLinkedVocal = (photoItem: CaptureItem) => {
    if (photoItem.type !== 'photo') return null
    return captures.find((c) => c.linked_photo_id === photoItem.id) ?? null
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* HEADER FIXE */}
      <header className="flex-shrink-0 bg-white border-b border-border px-4 py-3 pt-safe">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-foreground truncate">{chantier.client_nom}</h1>
            <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
              <span>{photoCount} photo{photoCount !== 1 ? 's' : ''}</span>
              <span>{vocalCount} vocal{vocalCount !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <button
            onClick={() => setShowEndModal(true)}
            disabled={captures.length === 0 || uploading}
            className="btn-secondary text-sm px-4 py-2 disabled:opacity-40"
          >
            Terminer
          </button>
        </div>
      </header>

      {/* TIMELINE SCROLLABLE */}
      <div
        ref={timelineRef}
        onScroll={handleTimelineScroll}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        <div className="max-w-lg mx-auto space-y-3">
          {timelineItems.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-4 opacity-40">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <p className="text-sm">Prenez une photo ou enregistrez<br />une observation vocale pour commencer.</p>
            </div>
          )}

          {timelineItems.map((item) => (
            <CaptureItemComponent
              key={item.id}
              item={item}
              linkedVocal={getLinkedVocal(item)}
              onDelete={handleDelete}
              onEditTranscription={handleEditTranscription}
            />
          ))}
        </div>
      </div>

      {/* BARRE D'ACTIONS FIXE */}
      <div className="flex-shrink-0 bg-white border-t border-border px-4 py-3 pb-safe">
        <div className="max-w-lg mx-auto">
        {/* Countdown indicator */}
        {describeMode && countdown > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs text-primary font-medium mb-1">
              <span>Décrivez cette photo...</span>
              <span>{countdown}s</span>
            </div>
            <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-1000 ease-linear"
                style={{ width: `${(countdown / 10) * 100}%` }}
              />
            </div>
          </div>
        )}

        {uploading && (
          <div className="mb-3 flex items-center gap-2 text-xs text-gray-400">
            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Upload en cours...
          </div>
        )}

        <div className="flex gap-3">
          <PhotoCapture onPhotoTaken={handlePhotoTaken} disabled={uploading} />
          <AudioRecorder
            onRecordingComplete={handleRecordingComplete}
            disabled={uploading}
            describeMode={describeMode}
          />
        </div>
        </div>
      </div>

      {/* MODALE FIN DE VISITE */}
      {showEndModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowEndModal(false)} />
          <div className="relative w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-6 pb-safe animate-slide-up sm:animate-scale-in">
            <h3 className="text-lg font-bold text-foreground mb-2">Terminer la visite ?</h3>
            <p className="text-gray-500 text-sm mb-6">
              {photoCount} photo{photoCount !== 1 ? 's' : ''} et {vocalCount} observation{vocalCount !== 1 ? 's' : ''} capturée{vocalCount !== 1 ? 's' : ''}.
              {'\n'}Générer le rapport ?
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowEndModal(false)} className="btn-tertiary flex-1">
                Continuer
              </button>
              <button onClick={handleEndVisit} className="btn-primary flex-1">
                Générer le rapport
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
