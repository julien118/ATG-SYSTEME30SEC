'use client'

import { useRef } from 'react'

interface PhotoCaptureProps {
  onPhotoTaken: (file: File) => void
  disabled?: boolean
}

export default function PhotoCapture({ onPhotoTaken, disabled }: PhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onPhotoTaken(file)
      // Reset input so same file can be selected again
      e.target.value = ''
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleChange}
        className="hidden"
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="flex-1 flex items-center justify-center gap-2 py-3 bg-white rounded-xl border border-border font-medium text-foreground transition-all hover:border-primary/30 active:scale-[0.97] disabled:opacity-50"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
        Photo
      </button>
    </>
  )
}
