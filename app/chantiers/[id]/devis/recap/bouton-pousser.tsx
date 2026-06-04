'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Spinner from '@/components/Spinner'
import { useToast } from '@/components/ToastProvider'

const ETAPES = [
  'Connexion à Costructor...',
  'Création du devis...',
  'Ajout des sections...',
  'Insertion des articles...',
  'Finalisation...',
]

interface Props {
  devisId: string
  chantierId: string
  // Le devis a deja ete pousse au moins une fois (costructor_devis_id present) :
  // on demande alors confirmation avant de le renvoyer (remplacement de l'ancien).
  dejaEnvoye?: boolean
}

export default function BoutonPousser({ devisId, chantierId: _chantierId, dejaEnvoye }: Props) {
  const router = useRouter()
  const toast = useToast()
  const [enCours, setEnCours] = useState(false)
  const [etape, setEtape] = useState(0)
  const [confirmOuvert, setConfirmOuvert] = useState(false)

  async function pousser() {
    if (enCours) return
    setEnCours(true)
    setEtape(0)

    // Animation visuelle pendant l'appel API (purement esthétique).
    const it = setInterval(() => {
      setEtape((e) => Math.min(e + 1, ETAPES.length - 1))
    }, 600)

    try {
      const res = await fetch('/api/devis/pousser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ devisId }),
      })
      clearInterval(it)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Échec push Costructor')
      router.refresh()
    } catch (e) {
      clearInterval(it)
      toast.show((e as Error).message, 'error')
      setEnCours(false)
    }
  }

  // Porte de confirmation : si le devis a deja ete envoye (id Costructor present),
  // on ouvre le pop-up avant de renvoyer ; sinon envoi DIRECT comme aujourd'hui.
  // pousser() et la route /api/devis/pousser restent strictement inchanges.
  function demarrer() {
    if (enCours) return
    if (dejaEnvoye) {
      setConfirmOuvert(true)
    } else {
      void pousser()
    }
  }

  function confirmerRemplacement() {
    setConfirmOuvert(false)
    void pousser()
  }

  if (enCours) {
    return (
      <div className="rounded-xl border border-primary bg-primary/5 p-4 text-center">
        <div className="mx-auto mb-2 inline-block">
          <Spinner className="h-6 w-6" />
        </div>
        <p className="text-sm text-gray-700">{ETAPES[etape]}</p>
      </div>
    )
  }

  return (
    <>
      <button
        onClick={demarrer}
        className="btn-primary w-full text-base py-3.5 flex items-center justify-center gap-2"
      >
        Envoyer vers Costructor
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>

      {/* Pop-up de confirmation de remplacement (uniquement si deja envoye). */}
      {confirmOuvert && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmOuvert(false)} />
          <div className="relative w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-6 pb-safe animate-slide-up sm:animate-scale-in">
            <h3 className="text-lg font-bold text-foreground mb-2">
              Ce devis est déjà sur Costructor
            </h3>
            <p className="text-gray-500 text-sm mb-6">
              Voulez-vous le remplacer par la nouvelle version ? L&apos;ancien devis
              sera supprimé sur Costructor et remplacé par celui-ci.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmOuvert(false)}
                className="btn-tertiary flex-1"
              >
                Annuler
              </button>
              <button
                onClick={confirmerRemplacement}
                className="btn-primary flex-1"
              >
                Remplacer et envoyer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
