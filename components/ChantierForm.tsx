'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toDatetimeLocal } from '@/lib/utils'
import AddressAutocomplete from './AddressAutocomplete'
import type { Chantier } from '@/lib/types'

interface ChantierFormProps {
  chantier?: Chantier | null
  userId: string
}

export default function ChantierForm({ chantier, userId }: ChantierFormProps) {
  const router = useRouter()
  const supabase = createClient()

  const [clientNom, setClientNom] = useState(chantier?.client_nom ?? '')
  const [clientAdresse, setClientAdresse] = useState(chantier?.client_adresse ?? '')
  const [objetTravaux, setObjetTravaux] = useState(chantier?.objet_travaux ?? '')
  const [dateVisite, setDateVisite] = useState(
    chantier?.date_visite
      ? toDatetimeLocal(new Date(chantier.date_visite))
      : toDatetimeLocal(new Date())
  )
  const [saving, setSaving] = useState(false)
  const [chantierId, setChantierId] = useState(chantier?.id ?? null)

  // Auto-save existing chantier on blur
  const autoSave = async () => {
    if (!chantierId) return
    await supabase
      .from('chantiers')
      .update({
        client_nom: clientNom,
        client_adresse: clientAdresse,
        objet_travaux: objetTravaux,
        date_visite: dateVisite ? new Date(dateVisite).toISOString() : null,
      })
      .eq('id', chantierId)
  }

  const handleStart = async () => {
    if (!clientNom.trim()) return
    setSaving(true)

    let id = chantierId

    if (!id) {
      // Create new chantier
      const { data, error } = await supabase
        .from('chantiers')
        .insert({
          user_id: userId,
          client_nom: clientNom.trim(),
          client_adresse: clientAdresse || null,
          objet_travaux: objetTravaux || null,
          date_visite: dateVisite ? new Date(dateVisite).toISOString() : null,
          statut: 'en_cours',
        })
        .select('id')
        .single()

      if (error || !data) {
        setSaving(false)
        return
      }
      id = data.id
      setChantierId(id)
    } else {
      // Update existing and set en_cours
      await supabase
        .from('chantiers')
        .update({
          client_nom: clientNom.trim(),
          client_adresse: clientAdresse || null,
          objet_travaux: objetTravaux || null,
          date_visite: dateVisite ? new Date(dateVisite).toISOString() : null,
          statut: 'en_cours',
        })
        .eq('id', id)
    }

    router.push(`/chantiers/${id}/visite`)
  }

  return (
    <div className="space-y-5">
      {/* Nom du client / chantier */}
      <div>
        <label htmlFor="client_nom" className="block text-sm font-medium text-foreground mb-1.5">
          Nom du client / chantier <span className="text-red-400">*</span>
        </label>
        <input
          id="client_nom"
          type="text"
          value={clientNom}
          onChange={(e) => setClientNom(e.target.value)}
          onBlur={autoSave}
          placeholder="Ex: M. Martin, Résidence Les Oliviers..."
          className="input-ionnyx"
          autoFocus
        />
      </div>

      {/* Adresse */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">
          Adresse du chantier
        </label>
        <AddressAutocomplete
          value={clientAdresse}
          onChange={setClientAdresse}
          onBlur={autoSave}
        />
      </div>

      {/* Objet des travaux */}
      <div>
        <label htmlFor="objet_travaux" className="block text-sm font-medium text-foreground mb-1.5">
          Objet des travaux
        </label>
        <textarea
          id="objet_travaux"
          value={objetTravaux}
          onChange={(e) => setObjetTravaux(e.target.value)}
          onBlur={autoSave}
          placeholder="Ex: Rénovation salle de bain, ouverture mur porteur..."
          rows={3}
          className="input-ionnyx resize-none"
        />
      </div>

      {/* Date de visite */}
      <div>
        <label htmlFor="date_visite" className="block text-sm font-medium text-foreground mb-1.5">
          Date et heure de la visite
        </label>
        <input
          id="date_visite"
          type="datetime-local"
          value={dateVisite}
          onChange={(e) => setDateVisite(e.target.value)}
          onBlur={autoSave}
          className="input-ionnyx"
        />
      </div>

      {/* CTA */}
      <button
        onClick={handleStart}
        disabled={!clientNom.trim() || saving}
        className="btn-primary w-full text-lg py-4 mt-4"
      >
        {saving ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Création...
          </span>
        ) : (
          'Démarrer la visite →'
        )}
      </button>
    </div>
  )
}
