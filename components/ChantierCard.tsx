'use client'

import { useRef, useCallback } from 'react'
import Link from 'next/link'
import type { Chantier } from '@/lib/types'
import { sectionDe, type StatutAffiche } from '@/lib/statut-affaire'
import StatusBadge from './StatusBadge'

interface ChantierCardProps {
  chantier: Chantier
  // Statut affiche derive (source de verite unique) : pilote A LA FOIS le badge ET
  // le routing (les statuts de la section Devis menent a l'ecran du devis).
  statutAffiche: StatutAffiche
  onLongPress: (chantier: Chantier) => void
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

function getChantierHref(chantier: Chantier, statutAffiche: StatutAffiche) {
  // Section Devis (Devis en cours / Devis envoye) : la carte mene directement a
  // l'ecran du devis pour le CONTINUER (sans jamais regenerer).
  if (sectionDe(statutAffiche) === 'devis') return `/chantiers/${chantier.id}/devis`
  // Généré ou Terminé : on ouvre le compte rendu (pas le formulaire d'edition).
  if (chantier.statut === 'rapport_genere' || chantier.statut === 'termine') {
    return `/chantiers/${chantier.id}/rapport`
  }
  // Planifié OU En cours (tant que le rapport n'est pas genere, point 7) : on
  // passe TOUJOURS par l'ecran contact. C'est de la que le bouton « Commencer »
  // ou « Continuer la visite » mene a l'ecran de visite technique.
  return `/chantiers/${chantier.id}`
}

export default function ChantierCard({ chantier, statutAffiche, onLongPress }: ChantierCardProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressedRef = useRef(false)

  const startPress = useCallback(() => {
    pressedRef.current = false
    timerRef.current = setTimeout(() => {
      pressedRef.current = true
      if (navigator.vibrate) navigator.vibrate(50)
      onLongPress(chantier)
    }, 600)
  }, [chantier, onLongPress])

  const endPress = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (pressedRef.current) {
      e.preventDefault()
      pressedRef.current = false
    }
  }, [])

  return (
    <Link
      href={getChantierHref(chantier, statutAffiche)}
      onClick={handleClick}
      onMouseDown={startPress}
      onMouseUp={endPress}
      onMouseLeave={endPress}
      onTouchStart={startPress}
      onTouchEnd={endPress}
      onTouchCancel={endPress}
      className="block bg-white rounded-xl border border-border p-4 hover:border-primary/30 transition-all active:scale-[0.98] animate-card-appear"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-foreground text-base truncate pr-3">
          {chantier.client_nom}
        </h3>
        <StatusBadge statut={statutAffiche} />
      </div>

      {chantier.client_adresse && (
        <p className="text-gray-400 text-sm truncate mb-1">
          {chantier.client_adresse}
        </p>
      )}

      {chantier.objet_travaux && (
        <p className="text-gray-500 text-sm truncate mb-2">
          {chantier.objet_travaux}
        </p>
      )}

      <div className="flex items-center gap-3 text-xs text-gray-400 mt-2">
        {chantier.date_visite && (
          <span>{formatDate(chantier.date_visite)}</span>
        )}
      </div>
    </Link>
  )
}
