'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import ReportView from '@/components/ReportView'
import Spinner from '@/components/Spinner'
import { useToast } from '@/components/ToastProvider'
import { fetchWithTimeout, nettoyerRapportContenu, nomFichierRapport } from '@/lib/utils'
import type { RapportContenu } from '@/lib/types'

interface RapportClientProps {
  chantierId: string
  initialRapport: RapportContenu | null
  heureVisite?: string | null
  dateVisiteIso?: string | null
  // Etape C : un devis existe deja pour ce chantier (on propose alors de le
  // CONTINUER, sans regenerer, au lieu de le PREPARER).
  aDevis?: boolean
}

const PROGRESS_STEPS = [
  'Analyse des captures...',
  'Corrélation photos et observations...',
  'Rédaction du rapport...',
  'Finalisation...',
]

// Étapes affichées pendant la génération du devis (animation ~30s).
const DEVIS_PROGRESS_STEPS = [
  'Lecture de vos observations...',
  'Sélection des articles dans Costructor...',
  'Rédaction des descriptions techniques...',
  'Justification poste par poste...',
  'Mise en page du dossier technique...',
]

export default function RapportClient({ chantierId, initialRapport, heureVisite, dateVisiteIso, aDevis }: RapportClientProps) {
  const router = useRouter()
  const supabase = createClient()

  const [rapport, setRapport] = useState<RapportContenu | null>(initialRapport)
  const [generating, setGenerating] = useState(false)
  const [progressStep, setProgressStep] = useState(0)
  const [error, setError] = useState('')
  const [preparingDevis, setPreparingDevis] = useState(false)
  const [devisProgressStep, setDevisProgressStep] = useState(0)
  const toast = useToast()
  const generationStarted = useRef(false)

  // Etape C : reouverture d'un devis EXISTANT. Navigation simple vers l'ecran du
  // devis, qui recharge sections_finales tel quel. N'appelle JAMAIS proposer (donc
  // n'ecrase jamais le travail). C'est le chemin "Continuer mon devis".
  const handleContinuerDevis = () => {
    router.push(`/chantiers/${chantierId}/devis`)
  }

  // Génère la proposition de devis depuis le CR puis bascule sur /devis.
  // Affiche une checklist progressive pendant l'appel (~25-35s) pour occuper.
  const handlePrepareDevis = async () => {
    if (preparingDevis) return
    setPreparingDevis(true)
    setDevisProgressStep(0)

    // Avance dans les étapes toutes les 5,5 secondes pour étaler sur la durée
    // moyenne d'un appel Claude. La dernière étape reste affichée jusqu'à la
    // redirection (l'utilisateur garde un feedback visuel "ça finalise").
    const stepInterval = setInterval(() => {
      setDevisProgressStep((prev) => {
        if (prev < DEVIS_PROGRESS_STEPS.length - 1) return prev + 1
        return prev
      })
    }, 5500)

    try {
      const res = await fetch('/api/devis/proposer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chantierId }),
      })
      clearInterval(stepInterval)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Échec préparation devis')
      }
      // Marque toutes les étapes comme terminées juste avant de naviguer.
      setDevisProgressStep(DEVIS_PROGRESS_STEPS.length)
      // Petit délai cosmétique pour laisser voir le dernier checkmark.
      setTimeout(() => {
        router.push(`/chantiers/${chantierId}/devis`)
      }, 400)
    } catch (e) {
      clearInterval(stepInterval)
      toast.show((e as Error).message, 'error')
      setPreparingDevis(false)
      setDevisProgressStep(0)
    }
  }

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
    // Garde-fou (lot 1.5) : on nettoie aussi a la sauvegarde d'une edition, au
    // cas ou un ** se glisserait (collage, ancien texte). Texte propre partout.
    const propre = nettoyerRapportContenu(updated)
    setRapport(propre)
    await supabase
      .from('rapports')
      .update({ contenu_json: propre })
      .eq('chantier_id', chantierId)
    toast.show('Rapport sauvegardé', 'success')
  }

  // URL du PDF avec le nom de fichier propre (compte-rendu-nom-date.pdf) porte
  // dans le DERNIER SEGMENT de l'URL : c'est ce que le navigateur reprend pour
  // nommer le PDF a la visualisation et au telechargement.
  const urlPdfRapport = (r: RapportContenu) =>
    `/api/export-pdf/${chantierId}/${encodeURIComponent(nomFichierRapport(r.client.nom, dateVisiteIso))}`

  // Ouvre le PDF du compte rendu dans un NOUVEL onglet (la page reste en place,
  // donc aucun etat de chargement a bloquer). rel-equivalent via noopener.
  const handleViewPdf = () => {
    if (!rapport) return
    window.open(urlPdfRapport(rapport), '_blank', 'noopener,noreferrer')
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
      {/* Overlay plein écran pendant la préparation du devis (animation ~30s) */}
      {preparingDevis && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center px-6 text-center pt-safe pb-safe">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center mb-8 animate-pulse">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="13" x2="15" y2="13" />
              <line x1="9" y1="17" x2="13" y2="17" />
            </svg>
          </div>

          <p className="text-sm font-semibold text-foreground mb-1">
            Préparation du dossier technique
          </p>
          <p className="text-xs text-gray-400 mb-8 max-w-xs">
            Vos observations sont transformées en sections, articles et descriptions techniques justifiées.
          </p>

          <div className="w-full max-w-xs space-y-3">
            {DEVIS_PROGRESS_STEPS.map((step, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 transition-all duration-500 ${
                  i <= devisProgressStep ? 'opacity-100' : 'opacity-30'
                }`}
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                  i < devisProgressStep
                    ? 'bg-primary text-white'
                    : i === devisProgressStep
                      ? 'bg-primary/20 text-primary animate-pulse'
                      : 'bg-gray-200 text-gray-400'
                }`}>
                  {i < devisProgressStep ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <span className="text-xs font-bold">{i + 1}</span>
                  )}
                </div>
                <span className="text-sm text-foreground text-left">{step}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* Bandeau Devis Express : point de bascule vers le module devis */}
        <div className="mb-5 rounded-2xl border border-primary bg-primary/5 p-4">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Compte rendu généré
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {aDevis
                  ? 'Un devis est déjà en préparation pour ce chantier. Vous pouvez le reprendre là où vous l\'avez laissé.'
                  : 'Vos observations peuvent maintenant être converties en brouillon de devis dans Costructor.'}
              </p>
            </div>
          </div>
          {aDevis ? (
            // Devis existant : on le CONTINUE (navigation, aucun appel proposer).
            <button
              onClick={handleContinuerDevis}
              className="btn-primary w-full text-sm py-3 flex items-center justify-center gap-2"
            >
              Continuer mon devis
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          ) : (
            // Aucun devis : premiere preparation (appelle proposer).
            <button
              onClick={handlePrepareDevis}
              disabled={preparingDevis}
              className="btn-primary w-full text-sm py-3 flex items-center justify-center gap-2"
            >
              {preparingDevis ? (
                <>
                  <Spinner className="h-4 w-4" />
                  Préparation du devis...
                </>
              ) : (
                <>
                  Préparer mon devis
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </>
              )}
            </button>
          )}
        </div>

        <ReportView contenu={rapport} onUpdate={handleUpdate} heureVisite={heureVisite} />
      </div>

      {/* Action bar */}
      <div className="flex-shrink-0 bg-white border-t border-border px-5 py-4 pb-safe space-y-2">
        <div className="flex gap-3">
          <button onClick={handleRegenerate} disabled={generating} className="btn-tertiary flex-1 text-sm py-3 flex items-center justify-center gap-1.5">
            {generating && <Spinner className="h-4 w-4" />}
            {generating ? 'Régénération...' : 'Régénérer'}
          </button>
          <button onClick={handleViewPdf} disabled={generating} className="btn-primary flex-1 text-sm py-3 flex items-center justify-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            Voir mon rapport
          </button>
        </div>
        <a
          href={urlPdfRapport(rapport)}
          download={nomFichierRapport(rapport.client.nom, dateVisiteIso)}
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
