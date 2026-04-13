'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import ReportView from '@/components/ReportView'
import Spinner from '@/components/Spinner'
import { useToast } from '@/components/ToastProvider'
import { fetchWithTimeout } from '@/lib/utils'
import type { RapportContenu } from '@/lib/types'

interface RapportClientProps {
  chantierId: string
  initialRapport: RapportContenu | null
}

const PROGRESS_STEPS = [
  'Analyse des captures...',
  'Corrélation photos et observations...',
  'Rédaction du rapport...',
  'Finalisation...',
]

export default function RapportClient({ chantierId, initialRapport }: RapportClientProps) {
  const router = useRouter()
  const supabase = createClient()

  const [rapport, setRapport] = useState<RapportContenu | null>(initialRapport)
  const [generating, setGenerating] = useState(false)
  const [progressStep, setProgressStep] = useState(0)
  const [error, setError] = useState('')
  const [viewingPdf, setViewingPdf] = useState(false)
  const toast = useToast()
  const generationStarted = useRef(false)

  const generate = useCallback(async () => {
    setGenerating(true)
    setError('')
    setProgressStep(0)

    // Animate progress steps
    const stepInterval = setInterval(() => {
      setProgressStep((prev) => {
        if (prev < PROGRESS_STEPS.length - 1) return prev + 1
        return prev
      })
    }, 3000)

    try {
      const res = await fetchWithTimeout('/api/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chantierId }),
      }, 60000)

      clearInterval(stepInterval)

      if (res.status === 403) {
        const data = await res.json()
        if (data.error === 'trial_limit_reached') {
          router.push('/essai-termine')
          return
        }
      }

      if (!res.ok) {
        setError('La génération a échoué. Réessayez.')
        setGenerating(false)
        return
      }

      const data = await res.json()
      setRapport(data.rapport)
      setProgressStep(PROGRESS_STEPS.length - 1)
    } catch (err) {
      clearInterval(stepInterval)
      const msg = err instanceof DOMException && err.name === 'AbortError'
        ? 'La génération prend trop de temps. Réessayez.'
        : 'Erreur de connexion. Vérifiez votre réseau.'
      setError(msg)
      toast.show(msg, 'error')
    }

    setGenerating(false)
  }, [chantierId, router, toast])

  // Auto-generate on mount if no rapport exists
  useEffect(() => {
    if (!initialRapport && !generationStarted.current) {
      generationStarted.current = true
      generate()
    }
  }, [initialRapport, generate])

  const handleRegenerate = () => {
    setRapport(null)
    generate()
  }

  const handleUpdate = async (updated: RapportContenu) => {
    setRapport(updated)
    await supabase
      .from('rapports')
      .update({ contenu_json: updated })
      .eq('chantier_id', chantierId)
    toast.show('Rapport sauvegardé', 'success')
  }

  const handleViewPdf = () => {
    setViewingPdf(true)
    window.location.href = `/api/export-pdf?chantierId=${chantierId}`
  }

  // ---- GENERATING VIEW ----
  if (generating) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        {/* Spinner */}
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center mb-8 animate-pulse">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>

        {/* Progress steps */}
        <div className="w-full max-w-xs space-y-3">
          {PROGRESS_STEPS.map((step, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 transition-all duration-500 ${
                i <= progressStep ? 'opacity-100' : 'opacity-30'
              }`}
            >
              <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                i < progressStep
                  ? 'bg-primary text-white'
                  : i === progressStep
                    ? 'bg-primary/20 text-primary animate-pulse'
                    : 'bg-gray-200 text-gray-400'
              }`}>
                {i < progressStep ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span className="text-xs font-bold">{i + 1}</span>
                )}
              </div>
              <span className="text-sm text-foreground">{step}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ---- ERROR VIEW ----
  if (error && !rapport) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mb-6">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <p className="text-foreground font-medium mb-2">{error}</p>
        <button onClick={generate} disabled={generating} className="btn-primary mt-4 flex items-center gap-2">
          {generating && <Spinner className="h-4 w-4" />}
          Réessayer
        </button>
      </div>
    )
  }

  // ---- REPORT VIEW ----
  if (!rapport) return null

  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <ReportView contenu={rapport} onUpdate={handleUpdate} />
      </div>

      {/* Action bar */}
      <div className="flex-shrink-0 bg-white border-t border-border px-5 py-4 pb-safe space-y-2">
        <div className="flex gap-3">
          <button onClick={handleRegenerate} disabled={generating || viewingPdf} className="btn-tertiary flex-1 text-sm py-3 flex items-center justify-center gap-1.5">
            {generating && <Spinner className="h-4 w-4" />}
            {generating ? 'Régénération...' : 'Régénérer'}
          </button>
          <button onClick={handleViewPdf} disabled={generating || viewingPdf} className="btn-primary flex-1 text-sm py-3 flex items-center justify-center gap-2">
            {viewingPdf ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            )}
            {viewingPdf ? 'Chargement...' : 'Voir mon rapport'}
          </button>
        </div>
        <a
          href={`/api/export-pdf?chantierId=${chantierId}`}
          download={`rapport-visite-${chantierId.slice(0, 8)}.pdf`}
          className="btn-tertiary w-full text-sm py-2.5 flex items-center justify-center gap-2"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Télécharger le rapport
        </a>
      </div>
    </>
  )
}
