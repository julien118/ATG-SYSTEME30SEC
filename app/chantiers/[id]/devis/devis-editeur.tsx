'use client'

// =============================================================
// DevisEditeur — écran devis en 2 phases
// =============================================================
// Phase A : Proposition technique. Le pro relit les descriptions
//           techniques générées par l'IA pour chaque article, ancrées
//           dans le contexte de la zone observée. Il valide.
// Phase B : Saisie des métrés. Champs quantité + dictée vocale + total live.
//           C'est la phase qui débouche sur le push Costructor.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ToastProvider'
import Spinner from '@/components/Spinner'
import type { ArticleRemplacable, SectionDevis } from '@/lib/types'

// Normalisation pour la recherche d'article : minuscules, accents retires.
function normaliserRecherche(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

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
  // Remplacement d'article (lot 4.3) : bibliotheque chargee en lazy une seule
  // fois, et cle de l'article dont la barre de recherche est ouverte.
  const [articlesBiblio, setArticlesBiblio] = useState<ArticleRemplacable[] | null>(null)
  const [chargementBiblio, setChargementBiblio] = useState(false)
  const [rechercheKey, setRechercheKey] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const debutRef = useRef<number>(0)
  // Auto-save des metres manuels (etape D) : timer du debounce + miroir des
  // sections courantes (la sauvegarde differee envoie toujours le dernier etat).
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sectionsRef = useRef<SectionDevis[]>(sectionsInitiales)
  // Drapeau "a vraiment modifie" (bug 4 vague 2) : faux au montage, passe a true
  // des qu'Olivier modifie reellement le devis (quantite, vocal, description,
  // remplacement). Sert a NE PAS sauvegarder sur une simple consultation (ouvrir
  // puis avancer vers le recap sans rien changer) : sinon la route retrograderait
  // le statut "Devis envoye" en "Devis en cours". Une ref (pas un state) : aucune
  // incidence sur le rendu.
  const aModifieRef = useRef(false)

  // Le miroir suit l'etat : la sauvegarde differee lira toujours la derniere valeur.
  useEffect(() => {
    sectionsRef.current = sections
  }, [sections])

  // Cleanup à la sortie du composant (TOUS les hooks AVANT le branchement de phase).
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
      if (intervalRef.current) clearInterval(intervalRef.current)
      // Annule un auto-save en attente : pas de sauvegarde apres demontage.
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current)
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

  // ---------- Auto-save des metres manuels (etape D) ----------

  // Annule un auto-save en attente. A appeler avant toute sauvegarde EXPLICITE
  // (vocal, recap) et quand une reponse serveur ramene de nouvelles sections,
  // pour qu'un debounce en retard n'ecrase jamais un etat plus recent.
  function annulerAutoSave() {
    if (autoSaveRef.current) {
      clearTimeout(autoSaveRef.current)
      autoSaveRef.current = null
    }
  }

  // Persiste silencieusement les sections via la route metres-vocaux en mode save
  // (route INCHANGEE). Pas de toast : c'est une sauvegarde de fond.
  async function sauvegardeAuto(sectionsAEnvoyer: SectionDevis[]) {
    try {
      const fd = new FormData()
      fd.append('devisId', devisId)
      fd.append('sections', JSON.stringify(sectionsAEnvoyer))
      await fetch('/api/devis/metres-vocaux', { method: 'POST', body: fd })
    } catch {
      // Silencieux : la prochaine frappe (ou "Voir le récapitulatif") reessaiera.
    }
  }

  // Programme une sauvegarde differee (anti-rafale ~1 s apres la derniere frappe).
  // Envoie le DERNIER etat (via sectionsRef) au moment ou le timer se declenche.
  function planifierSauvegarde() {
    annulerAutoSave()
    autoSaveRef.current = setTimeout(() => {
      autoSaveRef.current = null
      void sauvegardeAuto(sectionsRef.current)
    }, 1000)
  }

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
    // Edit utilisateur reel : on marque le devis comme modifie et on programme la
    // sauvegarde automatique differee.
    aModifieRef.current = true
    planifierSauvegarde()
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
    // Sauvegarde explicite : on annule un auto-save en attente (la reponse vocale
    // va ramener des sections autoritaires, qu'un debounce en retard ecraserait).
    annulerAutoSave()
    // Dictee des metres = vraie modification.
    aModifieRef.current = true
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
    // Sauvegarde explicite finale : on annule un auto-save en attente (on envoie
    // ici l'etat complet juste avant de naviguer).
    annulerAutoSave()
    // Garde consultation (bug 4 vague 2) : si rien n'a ete modifie depuis le
    // montage, on NE sauvegarde PAS (rien a persister) et on navigue directement.
    // Evite de retrograder un "Devis envoye" sur une simple consultation.
    if (!aModifieRef.current) {
      router.push(`/chantiers/${chantierId}/devis/recap`)
      return
    }
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
    setRechercheKey(null)
    setEditingKey(key)
    setEditDraft(description)
  }

  function annulerEdition() {
    setEditingKey(null)
    setEditDraft('')
  }

  async function sauverDescription(sIdx: number, aIdx: number) {
    if (savingDescription) return
    // Sauvegarde explicite : on annule un auto-save en attente (cet envoi porte
    // l'etat complet, quantites comprises).
    annulerAutoSave()
    // Edition d'une description = vraie modification.
    aModifieRef.current = true
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

  // ---------- Phase A : remplacement d'article (lot 4.3) ----------

  // Charge la bibliotheque (GET lecture seule) une seule fois, en lazy : on ne
  // paie le cout des produits Costructor qu'au premier usage du remplacement.
  async function chargerBiblio() {
    if (articlesBiblio || chargementBiblio) return
    setChargementBiblio(true)
    try {
      const res = await fetch('/api/devis/articles')
      if (!res.ok) throw new Error('Chargement de la bibliothèque échoué')
      const data = (await res.json()) as { articles: ArticleRemplacable[] }
      setArticlesBiblio(data.articles ?? [])
    } catch (e) {
      toast.show((e as Error).message ?? 'Bibliothèque indisponible', 'error')
    } finally {
      setChargementBiblio(false)
    }
  }

  function ouvrirRecherche(key: string) {
    annulerEdition()
    setRechercheKey(key)
    void chargerBiblio()
  }

  function fermerRecherche() {
    setRechercheKey(null)
  }

  // Remplace l'article cible par l'article choisi dans la bibliotheque : on
  // reprend libelle, unite et prix unitaire du NOUVEL article, on CONSERVE la
  // quantite saisie, et la description retombe sur le libelle (reeditable ensuite
  // via l'editeur inline). Effet immediat (etat local) puis persistance via la
  // route existante (mode save, sans audio) ; rollback si l'enregistrement echoue.
  async function choisirRemplacement(sIdx: number, aIdx: number, article: ArticleRemplacable) {
    // Sauvegarde explicite : on annule un auto-save en attente (cet envoi porte
    // l'etat complet, quantites comprises).
    annulerAutoSave()
    // Remplacement d'article = vraie modification.
    aModifieRef.current = true
    const precedentes = sections
    const sectionsMaj = sections.map((s) => ({
      ...s,
      articles: s.articles.map((a) => ({ ...a })),
    }))
    const cible = sectionsMaj[sIdx]?.articles[aIdx]
    if (!cible) {
      toast.show('Article introuvable', 'error')
      return
    }
    cible.costructor_article_id = article.costructor_article_id
    cible.libelle = article.libelle
    cible.unite = article.unite
    cible.prix_vente = article.prix_vente
    cible.description_technique = article.libelle
    // cible.quantite : inchangee (on garde la quantite deja saisie).

    setSections(sectionsMaj)
    fermerRecherche()

    try {
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
      toast.show('Article remplacé', 'success')
    } catch (e) {
      // Rollback : on restaure l'etat d'avant si la persistance a echoue.
      setSections(precedentes)
      toast.show((e as Error).message ?? 'Échec de l\'enregistrement', 'error')
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
                          <div className="mt-2 flex flex-wrap items-center gap-4">
                            <button
                              type="button"
                              onClick={() => ouvrirEdition(editKey, a.description_technique)}
                              className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                              </svg>
                              Modifier la description
                            </button>
                            <button
                              type="button"
                              onClick={() => ouvrirRecherche(editKey)}
                              className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="17 1 21 5 17 9" />
                                <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                                <polyline points="7 23 3 19 7 15" />
                                <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                              </svg>
                              Remplacer l&apos;article
                            </button>
                          </div>
                          {rechercheKey === editKey && (
                            <RechercheArticle
                              articles={articlesBiblio}
                              chargement={chargementBiblio}
                              onChoisir={(article) => choisirRemplacement(sIdx, aIdx, article)}
                              onFermer={fermerRecherche}
                            />
                          )}
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

// =========================================================
// Barre de recherche d'article (autocompletion, lot 4.3)
// =========================================================
// Filtrage 100 % en memoire sur la bibliotheque deja chargee : aucune requete
// reseau par frappe. Anti-rafale leger (150 ms), plafond de 8 propositions,
// recherche normalisee (accents et casse ignores) sur le libelle. Les
// propositions sont de VRAIS articles de la bibliotheque (anti-hallucination).
function RechercheArticle({
  articles,
  chargement,
  onChoisir,
  onFermer,
}: {
  articles: ArticleRemplacable[] | null
  chargement: boolean
  onChoisir: (article: ArticleRemplacable) => void
  onFermer: () => void
}) {
  const [texte, setTexte] = useState('')
  const [terme, setTerme] = useState('')

  // Anti-rafale : on ne recalcule le filtre qu'apres 150 ms sans frappe.
  useEffect(() => {
    const t = setTimeout(() => setTerme(texte), 150)
    return () => clearTimeout(t)
  }, [texte])

  const resultats = useMemo(() => {
    if (!articles) return []
    const q = normaliserRecherche(terme)
    if (q.length < 2) return []
    return articles
      .filter((a) => normaliserRecherche(a.libelle).includes(q))
      .slice(0, 8)
  }, [articles, terme])

  const termePret = normaliserRecherche(terme).length >= 2

  return (
    <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          placeholder="Rechercher un article (ex : écha, lavage, I4...)"
          autoFocus
          className="input-ionnyx flex-1 text-sm px-3 py-2"
        />
        <button
          type="button"
          onClick={onFermer}
          className="btn-tertiary text-xs px-3 py-2"
        >
          Fermer
        </button>
      </div>

      <div className="mt-2">
        {chargement && (
          <p className="text-xs text-gray-400 flex items-center gap-1.5">
            <Spinner className="h-3 w-3" />
            Chargement de votre bibliothèque...
          </p>
        )}
        {!chargement && !termePret && (
          <p className="text-[11px] text-gray-400">
            Tapez au moins 2 lettres pour chercher dans votre bibliothèque.
          </p>
        )}
        {!chargement && termePret && resultats.length === 0 && (
          <p className="text-xs text-gray-400">Aucun article ne correspond.</p>
        )}
        {!chargement && resultats.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border bg-white overflow-hidden">
            {resultats.map((a) => (
              <li key={a.costructor_article_id}>
                <button
                  type="button"
                  onClick={() => onChoisir(a)}
                  className="w-full text-left px-3 py-2 hover:bg-primary/5 transition flex items-baseline justify-between gap-3"
                >
                  <span className="text-xs text-foreground flex-1">{a.libelle}</span>
                  <span className="text-[11px] text-gray-400 whitespace-nowrap">
                    {formatEUR(a.prix_vente)} / {a.unite}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
