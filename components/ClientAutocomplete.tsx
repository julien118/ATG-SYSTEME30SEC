'use client'

// =============================================================
// Autocompletion du nom de client / chantier (groupe C)
// =============================================================
// Champ "Nom du client / chantier" de la creation de visite. Pendant la frappe,
// propose les contacts existants (Costructor + anciennes visites de l'app) ; en
// choisir un PREREMPLIT les coordonnees. 100 % LECTURE : aucune ecriture ici (la
// creation/lien du contact reste au push du devis, via le garde-fou compte test).
//
// Patron repris du remplacement d'article (lot 4.3) : la liste est chargee UNE
// fois (lazy, par le parent), filtree en MEMOIRE (normalisee, par jetons), plafond
// 8, anti-rafale ~150 ms. Aucun appel reseau par frappe.

import { useState, useRef, useEffect } from 'react'
import type { PropositionContact } from '@/lib/types'

function normaliser(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

// Civilites/particules ignorees : "Dupont" retrouve "M. et Mme Dupont".
const MOTS_VIDES = new Set([
  'm', 'mr', 'mme', 'mlle', 'monsieur', 'madame', 'mademoiselle',
  'et', 'de', 'du', 'des', 'la', 'le', 'les', 'l', 'aux', 'a',
])

function jetons(s: string): string[] {
  return normaliser(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !MOTS_VIDES.has(t))
}

// Tous les jetons significatifs de la recherche doivent etre presents dans le nom.
function correspond(nom: string, recherche: string): boolean {
  const cible = normaliser(nom)
  const j = jetons(recherche)
  if (j.length === 0) return false
  return j.every((t) => cible.includes(t))
}

interface ClientAutocompleteProps {
  value: string
  onChange: (value: string) => void
  onSelect: (proposition: PropositionContact) => void
  // Demande au parent de charger la liste (lazy) au premier focus.
  onFirstFocus: () => void
  propositions: PropositionContact[] | null
  chargement: boolean
  onBlur?: () => void
}

export default function ClientAutocomplete({
  value,
  onChange,
  onSelect,
  onFirstFocus,
  propositions,
  chargement,
  onBlur,
}: ClientAutocompleteProps) {
  const [ouvert, setOuvert] = useState(false)
  const [terme, setTerme] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  // Anti-rafale : on ne recalcule le filtre qu'apres 150 ms sans frappe.
  useEffect(() => {
    const t = setTimeout(() => setTerme(value), 150)
    return () => clearTimeout(t)
  }, [value])

  const resultats =
    propositions && normaliser(terme).length >= 2
      ? propositions.filter((p) => correspond(p.nom, terme)).slice(0, 8)
      : []

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOuvert(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative" ref={containerRef}>
      <input
        id="client_nom"
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOuvert(true)
        }}
        onFocus={() => {
          if (!propositions) onFirstFocus()
          setOuvert(true)
        }}
        onBlur={onBlur}
        placeholder="Ex: M. Martin, Résidence Les Oliviers..."
        className="input-ionnyx"
        autoFocus
        autoComplete="off"
      />

      {ouvert && normaliser(terme).length >= 2 && (
        <div className="absolute z-20 w-full mt-1 bg-white border border-border rounded-xl shadow-lg overflow-hidden">
          {chargement && !propositions ? (
            <p className="px-4 py-3 text-xs text-gray-400">Recherche dans vos contacts...</p>
          ) : resultats.length === 0 ? (
            <p className="px-4 py-3 text-xs text-gray-400">
              Aucun contact existant. Continuez à taper pour un nouveau client.
            </p>
          ) : (
            <ul>
              {resultats.map((p, i) => (
                <li key={`${p.source}-${p.nom}-${i}`}>
                  <button
                    type="button"
                    onMouseDown={() => {
                      onSelect(p)
                      setOuvert(false)
                    }}
                    className="w-full text-left px-4 py-3 hover:bg-input-focus transition-colors border-b border-border last:border-0"
                  >
                    <p className="text-sm font-medium text-foreground flex items-center gap-2">
                      {p.nom}
                      {p.source === 'app' && (
                        <span className="text-[10px] text-gray-400 font-normal">déjà visité</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400">
                      {p.ville ?? p.adresse ?? 'Coordonnées à compléter'}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
