'use client'

import { useState } from 'react'
import type { CaptureItem as CaptureItemType } from '@/lib/types'
import { urlImageRedimensionnee } from '@/lib/image-supabase'

interface CaptureItemProps {
  item: CaptureItemType
  linkedVocal?: CaptureItemType | null
  onDelete: (itemId: string, linkedId?: string | null) => void
  onEditTranscription: (itemId: string, text: string) => void
}

export default function CaptureItem({ item, linkedVocal, onDelete, onEditTranscription }: CaptureItemProps) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')

  const isPhoto = item.type === 'photo'
  const transcription = linkedVocal?.transcription ?? (item.type === 'vocal' ? item.transcription : null)
  const transcriptionId = linkedVocal?.id ?? (item.type === 'vocal' ? item.id : null)
  const isTranscribing = item.type === 'vocal' && !item.transcription && !linkedVocal
  const linkedIsTranscribing = linkedVocal && !linkedVocal.transcription

  const startEdit = () => {
    if (!transcription || !transcriptionId) return
    setEditText(transcription)
    setEditing(true)
  }

  const saveEdit = () => {
    if (transcriptionId && editText.trim()) {
      onEditTranscription(transcriptionId, editText.trim())
    }
    setEditing(false)
  }

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden animate-card-appear">
      {/* Photo */}
      {isPhoto && item.photo_url && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            // Vignette redimensionnee : evite de telecharger/decoder la photo pleine
            // resolution dans la timeline de visite (fluidite scroll mobile).
            src={urlImageRedimensionnee(item.photo_url, { width: 800, quality: 70 })}
            alt={`Capture #${item.position}`}
            loading="lazy"
            decoding="async"
            className="w-full max-h-64 object-contain bg-gray-50"
          />
          <span className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded-lg">
            #{item.position}
          </span>
        </div>
      )}

      {/* Vocal only (no photo) */}
      {!isPhoto && (
        <div className="flex items-center gap-2 px-4 pt-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            </svg>
          </div>
          <span className="text-xs text-gray-400">Vocal #{item.position}</span>
        </div>
      )}

      {/* Transcription area */}
      <div className="p-4">
        {(isTranscribing || linkedIsTranscribing) && (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Transcription en cours...
          </div>
        )}

        {transcription && !editing && (
          <p
            onClick={startEdit}
            className="text-sm text-foreground leading-relaxed cursor-pointer hover:bg-input-focus rounded-lg -mx-2 px-2 py-1 transition-colors"
          >
            {transcription}
          </p>
        )}

        {editing && (
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={saveEdit}
            autoFocus
            rows={3}
            className="input-ionnyx text-sm resize-none"
          />
        )}

        {/* Delete button */}
        <div className="flex justify-end mt-2">
          <button
            onClick={() => onDelete(item.id, linkedVocal?.id)}
            aria-label="Supprimer cette capture"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
