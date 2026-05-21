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
  const [clientTelephone, setClientTelephone] = useState(chantier?.client_telephone ?? '')
  const [clientEmail, setClientEmail] = useState(chantier?.client_email ?? '')
  const [objetTravaux, setObjetTravaux] = useState(chantier?.objet_travaux ?? '')
  const [dateVisite, setDateVisite] = useState(
    chantier?.date_visite
      ? toDatetimeLocal(new Date(chantier.date_visite))
      : toDatetimeLocal(new Date())
  )
  const [saving, setSaving] = useState(false)
  const [chantierId, setChantierId] = useState(chantier?.id ?? null)
  const [error, setError] = useState<string | null>(null)

  // Auto-save existing chantier on blur
  const autoSave = async () => {
    if (!chantierId) return
    await supabase
      .from('chantiers')
      .update({
        client_nom: clientNom,
        client_adresse: clientAdresse,
        client_telephone: clientTelephone || null,
        client_email: clientEmail || null,
        objet_travaux: objetTravaux,
        date_visite: dateVisite ? new Date(dateVisite).toISOString() : null,
      })
      .eq('id', chantierId)
  }

  const handleStart = async () => {
    if (!clientNom.trim()) return
    setSaving(true)
    setError(null)

    let id = chantierId

    if (!id) {
      // Create new chantier
      const { data, error: insertError } = await supabase
        .from('chantiers')
        .insert({
          user_id: userId,
          client_nom: clientNom.trim(),
          client_adresse: clientAdresse || null,
          client_telephone: clientTelephone.trim() || null,
          client_email: clientEmail.trim() || null,
          objet_travaux: objetTravaux || null,
          date_visite: dateVisite ? new Date(dateVisite).toISOString() : null,
          statut: 'en_cours',
        })
        .select('id')
        .single()

      if (insertError || !data) {
        console.error('[ChantierForm] insert chantier failed:', insertError)
        setError(insertError?.message ?? 'Création impossible')
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
          client_telephone: clientTelephone.trim() || null,
          client_email: clientEmail.trim() || null,
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

      {/* Téléphone */}
      <div>
        <label htmlFor="client_telephone" className="block text-sm font-medium text-foreground mb-1.5">
          Téléphone client
        </label>
        <input
          id="client_telephone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={clientTelephone}
          onChange={(e) => setClientTelephone(e.target.value)}
          onBlur={autoSave}
          placeholder="Ex: 06 12 34 56 78"
          className="input-ionnyx"
        />
      </div>

      {/* Email */}
      <div>
        <label htmlFor="client_email" className="block text-sm font-medium text-foreground mb-1.5">
          Email client
        </label>
        <input
          id="client_email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={clientEmail}
          onChange={(e) => setClientEmail(e.target.value)}
          onBlur={autoSave}
          placeholder="Ex: martin@example.com"
          className="input-ionnyx"
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
          placeholder="Ex: Ravalement complet façade, ITE, peinture extérieure, traitement fissures..."
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

      {/* Error visible */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

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
