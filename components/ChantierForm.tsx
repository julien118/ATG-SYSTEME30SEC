'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  arrondirAuCreneau,
  combinerDateHeure,
  creneauxHoraires,
  heureLaPlusProche,
  toDateInput,
} from '@/lib/utils'
import AddressAutocomplete from './AddressAutocomplete'
import ClientAutocomplete from './ClientAutocomplete'
import type { Chantier, ContactRecherche, PropositionContact } from '@/lib/types'

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
  // Date et heure separees (lot 1.2). Defaut a la creation : aujourd'hui + le
  // prochain creneau valide (jamais l'instant present a la minute). Pour un
  // chantier existant : on cale l'heure stockee sur le creneau le plus proche
  // (gere une heure ancienne hors creneau sans planter).
  const dateExistante = chantier?.date_visite ? new Date(chantier.date_visite) : null
  const [dateJour, setDateJour] = useState(
    toDateInput(dateExistante ?? new Date())
  )
  const [heure, setHeure] = useState(
    dateExistante ? heureLaPlusProche(dateExistante) : arrondirAuCreneau(new Date())
  )
  const CRENEAUX = creneauxHoraires()
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [chantierId, setChantierId] = useState(chantier?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  // Id de la visite tout juste CREEE : non null => on affiche le pop-up de
  // confirmation « commencer la visite maintenant / plus tard » au lieu de
  // naviguer immediatement (ce qui faisait « clignoter » la page). Concerne
  // uniquement la creation, jamais une visite deja existante.
  const [postCreateId, setPostCreateId] = useState<string | null>(null)

  // Autocompletion du nom de client/chantier (groupe C) : propositions chargees
  // UNE seule fois (lazy au premier focus), 100 % LECTURE. La creation/lien d'un
  // contact reste au push du devis (garde-fou compte test).
  const [propositions, setPropositions] = useState<PropositionContact[] | null>(null)
  const [chargementContacts, setChargementContacts] = useState(false)

  function normaliserNom(s: string): string {
    return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
  }

  // Charge les propositions : contacts Costructor (GET /api/contacts, lecture seule)
  // + anciennes visites de l'app (Supabase chantiers). Fusion + dedup par nom
  // (Costructor prioritaire). Non bloquant : un echec ne gene pas la saisie.
  async function chargerPropositions() {
    if (propositions || chargementContacts) return
    setChargementContacts(true)
    try {
      const res = await fetch('/api/contacts')
      const data = res.ok ? await res.json() : { contacts: [] }
      const costructor: PropositionContact[] = (data.contacts ?? []).map((c: ContactRecherche) => ({
        nom: c.nom,
        ville: c.ville,
        email: c.email,
        telephone: c.telephone,
        adresse: c.adresse,
        source: 'costructor' as const,
      }))
      const { data: chs } = await supabase
        .from('chantiers')
        .select('client_nom, client_adresse, client_telephone, client_email')
        .eq('user_id', userId)
      const app: PropositionContact[] = (chs ?? [])
        .filter((c) => (c.client_nom ?? '').trim())
        .map((c) => ({
          nom: (c.client_nom as string).trim(),
          ville: null,
          email: c.client_email ?? null,
          telephone: c.client_telephone ?? null,
          adresse: c.client_adresse ?? null,
          source: 'app' as const,
        }))
      const vus = new Set<string>()
      const fusion: PropositionContact[] = []
      for (const p of [...costructor, ...app]) {
        const cle = normaliserNom(p.nom)
        if (!cle || vus.has(cle)) continue
        vus.add(cle)
        fusion.push(p)
      }
      setPropositions(fusion)
    } catch {
      setPropositions([])
    } finally {
      setChargementContacts(false)
    }
  }

  // Preremplit les coordonnees a partir du contact choisi (sans ecraser un champ
  // par une valeur absente). Le lien reel se fait au push (dedup email/tel/nom).
  function selectionnerContact(p: PropositionContact) {
    setClientNom(p.nom)
    if (p.adresse) setClientAdresse(p.adresse)
    if (p.telephone) setClientTelephone(p.telephone)
    if (p.email) setClientEmail(p.email)
  }

  // Etat du chantier affiche dans le form (page de detail) : planifie => bouton
  // « Commencer la visite » ; en_cours => bouton « Continuer la visite » (point 7).
  const estPlanifie = chantier?.statut === 'planifie'
  const estEnCours = chantier?.statut === 'en_cours'

  // Persiste les champs courants du chantier existant (mise a jour seulement :
  // l'auto-save ne cree jamais de ligne, d'ou le garde-fou chantierId). Appele
  // par l'auto-save debounce (point 6).
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
        date_visite: combinerDateHeure(dateJour, heure).toISOString(),
      })
      .eq('id', chantierId)
  }

  // Auto-save PERMANENT debounce (point 6, vague 2) : on persiste a chaque pause
  // de frappe (~800 ms), sur le meme principe que l'auto-save des metres. Le
  // bouton "Enregistrer les modifications" devient inutile et est retire.
  // - anti-rafale : chaque frappe annule le timer precedent ;
  // - nettoyage au demontage : pas de sauvegarde apres depart de l'ecran ;
  // - skip du tout premier rendu : pas de reecriture inutile des valeurs initiales ;
  // - uniquement si chantierId existe (en creation, rien a mettre a jour : c'est
  //   le bouton "Enregistrer la visite" qui cree la premiere ligne).
  const premierRenduRef = useRef(true)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (premierRenduRef.current) {
      premierRenduRef.current = false
      return
    }
    if (!chantierId) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      void autoSave()
    }, 800)
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientNom, clientAdresse, clientTelephone, clientEmail, objetTravaux, dateJour, heure, chantierId])

  // Champs du chantier (hors statut), recopies a chaque ecriture.
  const champsChantier = () => ({
    client_nom: clientNom.trim(),
    client_adresse: clientAdresse || null,
    client_telephone: clientTelephone.trim() || null,
    client_email: clientEmail.trim() || null,
    objet_travaux: objetTravaux || null,
    date_visite: combinerDateHeure(dateJour, heure).toISOString(),
  })

  // Enregistre la visite SANS la lancer : une creation part en "Planifié" (rdv a
  // venir). A la creation reussie, on N'EFFECTUE PLUS de navigation immediate
  // (qui faisait atterrir sur la page detail, d'ou le « clignotement ») : on
  // ouvre un pop-up de confirmation, la navigation se fait sur le choix d'Olivier.
  const handleSave = async () => {
    if (!clientNom.trim()) return
    setSaving(true)
    setError(null)

    const id = chantierId

    if (!id) {
      const { data, error: insertError } = await supabase
        .from('chantiers')
        .insert({ user_id: userId, ...champsChantier(), statut: 'planifie' })
        .select('id')
        .single()

      if (insertError || !data) {
        console.error('[ChantierForm] insert chantier failed:', insertError)
        setError(insertError?.message ?? 'Création impossible')
        setSaving(false)
        return
      }
      // Creation OK : on memorise l'id (active l'auto-save) et on ouvre le pop-up.
      setChantierId(data.id)
      setPostCreateId(data.id)
      setSaving(false)
      return
    }

    // Cas defensif (visite deja existante) : sauvegarde + retour au detail.
    await supabase.from('chantiers').update(champsChantier()).eq('id', id)
    router.push(`/chantiers/${id}`)
  }

  // Pop-up post-creation : « Commencer la visite » passe la visite « En cours »
  // (comme handleCommencerVisite) puis ouvre l'ecran de visite technique.
  const demarrerVisiteCreee = async () => {
    if (!postCreateId || starting) return
    setStarting(true)
    await supabase
      .from('chantiers')
      .update({ ...champsChantier(), statut: 'en_cours' })
      .eq('id', postCreateId)
    router.push(`/chantiers/${postCreateId}/visite`)
  }

  // Pop-up post-creation : « Plus tard » revient a l'accueil (liste des visites).
  const remettreVisiteAPlusTard = () => {
    router.push('/chantiers')
  }

  // Lance la visite : enregistre les dernieres infos ET passe le chantier
  // "En cours", puis ouvre l'ecran de visite.
  const handleCommencerVisite = async () => {
    if (!chantierId || starting) return
    setStarting(true)
    setError(null)
    await supabase
      .from('chantiers')
      .update({ ...champsChantier(), statut: 'en_cours' })
      .eq('id', chantierId)
    router.push(`/chantiers/${chantierId}/visite`)
  }

  // Reprend une visite DEJA en cours (point 7) : on sauvegarde les derniers champs
  // puis on ouvre l'ecran de visite. On NE change PAS le statut (deja en_cours).
  const continuerVisite = async () => {
    if (!chantierId || starting) return
    setStarting(true)
    setError(null)
    await supabase.from('chantiers').update(champsChantier()).eq('id', chantierId)
    router.push(`/chantiers/${chantierId}/visite`)
  }

  return (
    <div className="space-y-5">
      {/* Nom du client / chantier */}
      <div>
        <label htmlFor="client_nom" className="block text-sm font-medium text-foreground mb-1.5">
          Nom du client / chantier <span className="text-red-400">*</span>
        </label>
        <ClientAutocomplete
          value={clientNom}
          onChange={setClientNom}
          onSelect={selectionnerContact}
          onFirstFocus={chargerPropositions}
          propositions={propositions}
          chargement={chargementContacts}        />
      </div>

      {/* Adresse */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">
          Adresse du chantier
        </label>
        <AddressAutocomplete
          value={clientAdresse}
          onChange={setClientAdresse}        />
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
          onChange={(e) => setClientTelephone(e.target.value)}          placeholder="Ex: 06 12 34 56 78"
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
          onChange={(e) => setClientEmail(e.target.value)}          placeholder="Ex: martin@example.com"
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
          onChange={(e) => setObjetTravaux(e.target.value)}          placeholder="Ex: Ravalement complet façade, ITE, peinture extérieure, traitement fissures..."
          rows={3}
          className="input-ionnyx resize-none"
        />
      </div>

      {/* Date et heure de la visite (lot 1.2) : date a gauche (large), heure a
          droite (creneaux 30 min de 07:00 a 18:30, menu deroulant). */}
      <div>
        <label htmlFor="date_visite_jour" className="block text-sm font-medium text-foreground mb-1.5">
          Date et heure de la visite
        </label>
        <div className="flex gap-2">
          <input
            id="date_visite_jour"
            type="date"
            value={dateJour}
            onChange={(e) => setDateJour(e.target.value)}            className="input-ionnyx flex-[2] min-w-0"
          />
          <select
            id="date_visite_heure"
            value={heure}
            onChange={(e) => setHeure(e.target.value)}            aria-label="Heure de la visite"
            className="input-ionnyx flex-1 min-w-0"
          >
            {CRENEAUX.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Error visible */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* CTA */}
      {estPlanifie ? (
        // Page de detail d'un chantier "Planifié" : seule action = commencer la
        // visite. Les modifications d'infos sont desormais sauvegardees en
        // permanence (auto-save debounce, point 6), donc plus de bouton
        // "Enregistrer les modifications".
        <div className="space-y-3 mt-4">
          <button
            onClick={handleCommencerVisite}
            disabled={!clientNom.trim() || starting || saving}
            className="btn-primary w-full text-lg py-4"
          >
            {starting ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Démarrage...
              </span>
            ) : (
              'Commencer la visite →'
            )}
          </button>
        </div>
      ) : estEnCours ? (
        // Visite DEJA en cours (point 7) : on la continue (ecran de visite), le
        // statut reste « en_cours ». Les infos sont sauvegardees en permanence.
        <button
          onClick={continuerVisite}
          disabled={!clientNom.trim() || starting}
          className="btn-primary w-full text-lg py-4 mt-4"
        >
          {starting ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Ouverture...
            </span>
          ) : (
            'Continuer la visite →'
          )}
        </button>
      ) : (
        // Creation (pas encore de chantierId) : on enregistre la visite (Planifié).
        <button
          onClick={handleSave}
          disabled={!clientNom.trim() || saving}
          className="btn-primary w-full text-lg py-4 mt-4"
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Enregistrement...
            </span>
          ) : (
            'Enregistrer la visite'
          )}
        </button>
      )}

      {/* Pop-up post-creation (style coherent avec DeleteChantierModal / fin de
          visite) : s'affiche apres une creation reussie, sans rechargement
          visible de la page (pas de « clignotement »). */}
      {postCreateId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-6 pb-safe animate-slide-up sm:animate-scale-in">
            <h3 className="text-lg font-bold text-foreground mb-2">
              Visite enregistrée
            </h3>
            <p className="text-gray-500 text-sm mb-6">
              Souhaitez-vous commencer la visite maintenant ?
            </p>
            <div className="flex gap-3">
              <button
                onClick={remettreVisiteAPlusTard}
                disabled={starting}
                className="btn-tertiary flex-1"
              >
                Plus tard
              </button>
              <button
                onClick={demarrerVisiteCreee}
                disabled={starting}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {starting ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Démarrage...
                  </>
                ) : (
                  'Commencer la visite'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
