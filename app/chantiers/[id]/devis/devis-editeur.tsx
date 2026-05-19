'use client'

// =============================================================
// DevisEditeur — écran devis en 2 phases
// =============================================================
// Phase A : Proposition technique. Le pro relit les descriptions
//           techniques générées par l'IA pour chaque article, ancrées
//           dans le contexte de la zone observée. Il valide.
// Phase B : Saisie des métrés. Champs quantité + dictée vocale + total live.
//           C'est la phase qui débouche sur le push Costructor.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ToastProvider'
import Spinner from '@/components/Spinner'
import type { SectionDevis } from '@/lib/types'

type Phase = 'technique' | 'metres'
type EtatMicro = 'pret' | 'enregistre' | 'traitement' | 'erreur'

interface Props {
  chantierId: string
  devisId: string
  sectionsInitiales: SectionDevis[]
}

function formatEUR(n: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(n)
}

export default function DevisEditeur({ chantierId, devisId, sectionsInitiales }: Props) {
  const router = useRouter()
  const toast = useToast()

  const [phase, setPhase] = useState<Phase>('technique')
  const [sections, setSections] = useState<SectionDevis[]>(sectionsInitiales)
  const [etat, setEtat] = useState<EtatMicro>('pret')
  const [duree, setDuree] = useState(0)
  const [animKeys, setAnimKeys] = useState<Record<string, boolean>>({})
  const [enregistrement, setEnregistrement] = useState(false)
  // Édition inline des descriptions en Phase A.
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<string>('')
  const [savingDescription, setSavingDescription] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const debutRef = useRef<number>(0)

  // Cleanup à la sortie du composant (TOUS les hooks AVANT le branchement de phase).
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const totalHT = Math.round(
    sections.reduce(
      (acc, s) =>
        acc + s.articles.reduce((sa, a) => sa + (a.quantite ?? 0) * a.prix_vente, 0),
      0,
    ) * 100,
  ) / 100
  const totalTTC = Math.round(totalHT * 1.1 * 100) / 100

  // ---------- Phase B : helpers ----------
  function modifierQuantite(sectionIdx: number, articleIdx: number, valeur: string) {
    const v = valeur === '' ? null : Number(valeur)
    setSections((prev) => {
      const copie = prev.map((s) => ({
        ...s,
        articles: s.articles.map((a) => ({ ...a })),
      }))
      const article = copie[sectionIdx]?.articles[articleIdx]
      if (article) {
        article.quantite = v != null && Number.isFinite(v) && v >= 0 ? v : null
      }
      return copie
    })
  }

  async function demarrer() {
    setDuree(0)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        if (intervalRef.current) clearInterval(intervalRef.current)
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        await envoyerAudio(blob)
      }
      recorder.start()
      debutRef.current = Date.now()
      intervalRef.current = setInterval(() => {
        setDuree(Math.floor((Date.now() - debutRef.current) / 1000))
      }, 500)
      setEtat('enregistre')
    } catch (e) {
      toast.show((e as Error).message ?? 'Permission micro refusée', 'error')
      setEtat('erreur')
    }
  }

  function arreter() {
    recorderRef.current?.stop()
    setEtat('traitement')
  }

  async function envoyerAudio(blob: Blob) {
    try {
      const fd = new FormData()
      fd.append('devisId', devisId)
      fd.append('audio', new File([blob], 'metres.webm', { type: 'audio/webm' }))
      fd.append('sections', JSON.stringify(sections))

      const res = await fetch('/api/devis/metres-vocaux', {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t || `Erreur ${res.status}`)
      }
      const data = (await res.json()) as { sections: SectionDevis[] }

      const nouvellesAnim: Record<string, boolean> = {}
      for (let i = 0; i < data.sections.length; i++) {
        const sNouv = data.sections[i]
        const sAvant = sections[i]
        if (!sNouv) continue
        for (let j = 0; j < sNouv.articles.length; j++) {
          const aNouv = sNouv.articles[j]
          const aAvant = sAvant?.articles[j]
          if (aNouv && aNouv.quantite !== aAvant?.quantite) {
            nouvellesAnim[`${sNouv.nom}::${aNouv.libelle}`] = true
          }
        }
      }

      setSections(data.sections)
      setAnimKeys(nouvellesAnim)
      setEtat('pret')
      setTimeout(() => setAnimKeys({}), 1200)
    } catch (e) {
      toast.show((e as Error).message, 'error')
      setEtat('erreur')
    }
  }

  async function allerAuRecap() {
    if (enregistrement) return
    setEnregistrement(true)
    try {
      const fd = new FormData()
      fd.append('devisId', devisId)
      fd.append('sections', JSON.stringify(sections))
      const res = await fetch('/api/devis/metres-vocaux', {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t || `Erreur ${res.status}`)
      }
      router.push(`/chantiers/${chantierId}/devis/recap`)
    } catch (e) {
      toast.show((e as Error).message, 'error')
      setEnregistrement(false)
    }
  }

  // =========================================================
  // PHASE A — Proposition technique (avec édition inline)
  // =========================================================

  // Helpers édition inline
  function ouvrirEdition(key: string, description: string) {
    setEditingKey(key)
    setEditDraft(description)
  }

  function annulerEdition() {
    setEditingKey(null)
    setEditDraft('')
  }

  async function sauverDescription(sIdx: number, aIdx: number) {
    if (savingDescription) return
    setSavingDescription(true)
    try {
      // Met à jour le state local.
      const sectionsMaj = sections.map((s) => ({
        ...s,
        articles: s.articles.map((a) => ({ ...a })),
      }))
      const article = sectionsMaj[sIdx]?.articles[aIdx]
      if (!article) throw new Error('Article introuvable')
      article.description_technique = editDraft.trim()

      // Persiste toutes les sections via la route métrés-vocaux (mode save sans audio).
      const fd = new FormData()
      fd.append('devisId', devisId)
      fd.append('sections', JSON.stringify(sectionsMaj))
      const res = await fetch('/api/devis/metres-vocaux', {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t || `Erreur ${res.status}`)
      }
      setSections(sectionsMaj)
      setEditingKey(null)
      setEditDraft('')
      toast.show('Description mise à jour', 'success')
    } catch (e) {
      toast.show((e as Error).message, 'error')
    } finally {
      setSavingDescription(false)
    }
  }

  if (phase === 'technique') {
    const totalArticles = sections.reduce((acc, s) => acc + s.articles.length, 0)
    return (
      <>
        <main className="flex-1 overflow-y-auto px-5 py-4 pb-32 max-w-2xl mx-auto w-full">
          <div className="mb-5 rounded-2xl bg-primary/5 border border-primary p-4">
            <p className="text-sm font-semibold text-foreground mb-1">
              Proposition technique
            </p>
            <p className="text-xs text-gray-600">
              L&apos;IA a structuré votre devis en {sections.length} sections et {totalArticles} postes,
              avec pour chacun un descriptif technique justifié par vos observations.
              Vous pouvez modifier chaque description avant de saisir les métrés.
            </p>
          </div>

          {sections.map((s, sIdx) => (
            <section
              key={`${s.nom}-${sIdx}`}
              className="mb-5 rounded-2xl border border-border bg-white p-4"
            >
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-primary">
                {s.nom}
              </h2>
              <ul className="space-y-5">
                {s.articles.map((a, aIdx) => {
                  const editKey = `${sIdx}::${aIdx}`
                  const enEdition = editingKey === editKey
                  return (
                    <li
                      key={`${a.costructor_article_id}-${aIdx}`}
                      className="border-l-2 border-primary/30 pl-3"
                    >
                      <div className="flex items-baseline justify-between gap-2 mb-2">
                        <p className="text-sm font-semibold text-foreground flex-1">
                          {a.libelle}
                        </p>
                        <p className="text-xs text-gray-400 whitespace-nowrap">
                          {formatEUR(a.prix_vente)} / {a.unite}
                        </p>
                      </div>

                      {enEdition ? (
                        <div className="space-y-2">
                          <textarea
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            rows={10}
                            className="input-ionnyx w-full text-xs leading-relaxed resize-y min-h-[140px]"
                            placeholder="Décris la technique mise en oeuvre sur ce poste..."
                            autoFocus
                          />
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] text-gray-400">
                              {editDraft.length} caractères
                            </span>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={annulerEdition}
                                disabled={savingDescription}
                                className="btn-tertiary text-xs px-3 py-1.5"
                              >
                                Annuler
                              </button>
                              <button
                                type="button"
                                onClick={() => sauverDescription(sIdx, aIdx)}
                                disabled={savingDescription || !editDraft.trim()}
                                className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
                              >
                                {savingDescription && <Spinner className="h-3 w-3" />}
                                Enregistrer
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="group">
                          <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-line">
                            {a.description_technique}
                          </p>
                          <button
                            type="button"
                            onClick={() => ouvrirEdition(editKey, a.description_technique)}
                            className="mt-2 text-[11px] text-primary hover:underline inline-flex items-center gap-1"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                            </svg>
                            Modifier la description
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </main>

        {/* Sticky CTA Phase A → B */}
        <div className="fixed bottom-0 inset-x-0 z-40 px-5 py-4 pb-safe bg-white border-t border-border">
          <div className="max-w-2xl mx-auto">
            <button
              type="button"
              onClick={() => setPhase('metres')}
              className="btn-primary w-full text-base py-3.5 flex items-center justify-center gap-2"
            >
              Valider la technique, passer aux métrés
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        </div>
      </>
    )
  }

  // =========================================================
  // PHASE B — Saisie des métrés
  // =========================================================
  const enCours = etat === 'enregistre'
  const traitement = etat === 'traitement'

  return (
    <>
      <main className="flex-1 overflow-y-auto px-5 py-4 pb-44 max-w-2xl mx-auto w-full">
        <button
          type="button"
          onClick={() => setPhase('technique')}
          className="mb-3 text-xs text-gray-500 underline"
        >
          ← Revoir la technique
        </button>

        <section className="mb-5 rounded-2xl border border-primary bg-primary/5 p-5">
          <p className="text-xs uppercase tracking-wide text-primary text-center mb-3 font-semibold">
            Saisie des métrés à la voix
          </p>
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={enCours ? arreter : demarrer}
              disabled={traitement}
              className={`flex h-20 w-20 items-center justify-center rounded-full text-3xl transition active:scale-95 ${
                enCours
                  ? 'bg-red-500 text-white animate-pulse'
                  : 'bg-primary text-white'
              } ${traitement ? 'opacity-50' : ''}`}
              aria-label={enCours ? 'Arrêter' : 'Dicter les métrés'}
            >
              {traitement ? <Spinner className="h-6 w-6" /> : enCours ? '■' : '🎙'}
            </button>
            <p className="text-xs text-gray-500">
              {etat === 'pret' && 'Touchez pour parler'}
              {enCours && `Enregistrement... ${duree}s`}
              {traitement && 'Je calcule...'}
              {etat === 'erreur' && 'Réessayez'}
            </p>
          </div>
          <p className="mt-3 text-center text-[10px] text-gray-400">
            Ex : &quot;Façade sud 45 mètres carrés, 12 mètres linéaires de fissures...&quot;
          </p>
        </section>

        {sections.map((s, sIdx) => (
          <section
            key={`${s.nom}-${sIdx}`}
            className="mb-4 rounded-2xl border border-border bg-white p-4"
          >
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-primary">
              {s.nom}
            </h2>
            <ul className="space-y-2.5">
              {s.articles.map((a, aIdx) => {
                const animKey = `${s.nom}::${a.libelle}`
                const enAnim = animKeys[animKey]
                return (
                  <li
                    key={`${a.costructor_article_id}-${aIdx}`}
                    className="flex items-center gap-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{a.libelle}</p>
                      <p className="text-xs text-gray-400">
                        {formatEUR(a.prix_vente)} / {a.unite}
                      </p>
                    </div>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      value={a.quantite ?? ''}
                      onChange={(e) => modifierQuantite(sIdx, aIdx, e.target.value)}
                      placeholder="0"
                      className={`input-ionnyx w-20 px-2 py-2 text-right text-sm ${
                        enAnim ? 'ring-2 ring-primary' : ''
                      }`}
                    />
                    <span className="w-8 text-xs text-gray-400">{a.unite}</span>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </main>

      <div className="fixed bottom-0 inset-x-0 z-40 px-5 py-4 pb-safe bg-white border-t border-border">
        <div className="max-w-2xl mx-auto">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-gray-500">Total HT</span>
            <span className="text-lg font-bold text-primary">{formatEUR(totalHT)}</span>
          </div>
          <button
            type="button"
            onClick={allerAuRecap}
            disabled={enregistrement || totalHT === 0}
            className="btn-primary w-full text-base py-3.5 flex items-center justify-center gap-2"
          >
            {enregistrement ? (
              <>
                <Spinner className="h-4 w-4" />
                Sauvegarde...
              </>
            ) : (
              <>
                Voir le récapitulatif - {formatEUR(totalTTC)} TTC
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </>
  )
}
