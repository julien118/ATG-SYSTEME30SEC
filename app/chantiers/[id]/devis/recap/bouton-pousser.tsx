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
}

export default function BoutonPousser({ devisId, chantierId: _chantierId }: Props) {
  const router = useRouter()
  const toast = useToast()
  const [enCours, setEnCours] = useState(false)
  const [etape, setEtape] = useState(0)

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
    <button
      onClick={pousser}
      className="btn-primary w-full text-base py-3.5 flex items-center justify-center gap-2"
    >
      Envoyer vers Costructor
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" />
      </svg>
    </button>
  )
}
