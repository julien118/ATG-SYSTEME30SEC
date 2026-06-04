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
  // Demande de suppression : OUVRE le pop-up de confirmation (ne supprime jamais
  // directement). Declenche par l'icone corbeille visible OU par l'appui long.
  onDelete: (chantier: Chantier) => void
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

export default function ChantierCard({ chantier, statutAffiche, onDelete }: ChantierCardProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressedRef = useRef(false)

  const startPress = useCallback(() => {
    pressedRef.current = false
    timerRef.current = setTimeout(() => {
      pressedRef.current = true
      if (navigator.vibrate) navigator.vibrate(50)
      onDelete(chantier)
    }, 600)
  }, [chantier, onDelete])

  // Icone corbeille : OUVRE le pop-up de confirmation. preventDefault +
  // stopPropagation pour ne pas declencher la navigation du Link de la carte.
  const handleTrashClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onDelete(chantier)
    },
    [chantier, onDelete],
  )

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
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-semibold text-foreground text-base truncate pr-3">
          {chantier.client_nom}
        </h3>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <StatusBadge statut={statutAffiche} />
          <button
            type="button"
            onClick={handleTrashClick}
            aria-label="Supprimer cette fiche"
            className="p-1 -mr-1 text-gray-300 hover:text-red-500 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
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
