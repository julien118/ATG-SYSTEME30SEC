'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface AddressAutocompleteProps {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
}

interface Suggestion {
  label: string
  context: string
}

export default function AddressAutocomplete({ value, onChange, onBlur }: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 3) {
      setSuggestions([])
      return
    }
    try {
      const res = await fetch(
        `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=5`
      )
      const data = await res.json()
      setSuggestions(
        data.features?.map((f: { properties: { label: string; context: string } }) => ({
          label: f.properties.label,
          context: f.properties.context,
        })) ?? []
      )
      setOpen(true)
    } catch {
      setSuggestions([])
    }
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    onChange(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 300)
  }

  const handleSelect = (label: string) => {
    onChange(label)
    setOpen(false)
    setSuggestions([])
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onBlur={onBlur}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder="Rechercher une adresse..."
        className="input-ionnyx"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 w-full mt-1 bg-white border border-border rounded-xl shadow-lg overflow-hidden">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={() => handleSelect(s.label)}
                className="w-full text-left px-4 py-3 hover:bg-input-focus transition-colors border-b border-border last:border-0"
              >
                <p className="text-sm font-medium text-foreground">{s.label}</p>
                <p className="text-xs text-gray-400">{s.context}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
