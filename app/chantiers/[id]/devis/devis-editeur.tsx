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
import type { ArticleDevis, ArticleRemplacable, SectionDevis } from '@/lib/types'

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
  // Phase d'ouverture (point 13) : « metres » quand on revient du recap via la
  // fleche « Saisir les metres » (?etape=metres). Defaut « technique ».
  phaseInitiale?: Phase
}

function formatEUR(n: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(n)
}

export default function DevisEditeur({ chantierId, devisId, sectionsInitiales, phaseInitiale }: Props) {
  const router = useRouter()
  const toast = useToast()

  const [phase, setPhase] = useState<Phase>(phaseInitiale ?? 'technique')
  const [sections, setSections] = useState<SectionDevis[]>(sectionsInitiales)
  const [etat, setEtat] = useState<EtatMicro>('pret')
  const [duree, setDuree] = useState(0)
  const [animKeys, setAnimKeys] = useState<Record<string, boolean>>({})
  const [enregistrement, setEnregistrement] = useState(false)
  // Édition inline des descriptions en Phase A.
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<string>('')
  const [savingDescription, setSavingDescription] = useState(false)
  // Renommage inline d'une SECTION en Phase A (etat dedie, distinct de l'edition de
  // description ci-dessus) : index de la section en cours de renommage + brouillon
  // du titre + verrou de sauvegarde.
  const [editSectionIdx, setEditSectionIdx] = useState<number | null>(null)
  const [editSectionDraft, setEditSectionDraft] = useState<string>('')
  const [savingSection, setSavingSection] = useState(false)
  // Section JUSTE CREEE et PAS ENCORE CONFIRMEE (titre jamais enregistre, aucun
  // article ajoute) : « Annuler » son renommage la RETIRE (on renonce a l'ajout).
  // Remis a null des qu'elle est confirmee (premier enregistrement de titre OU
  // ajout d'un article). Toujours la derniere section ajoutee (append en bout).
  const [sectionNouvelleIdx, setSectionNouvelleIdx] = useState<number | null>(null)
  // Remplacement d'article (lot 4.3) : bibliotheque chargee en lazy une seule
  // fois, et cle de l'article dont la barre de recherche est ouverte.
  const [articlesBiblio, setArticlesBiblio] = useState<ArticleRemplacable[] | null>(null)
  const [chargementBiblio, setChargementBiblio] = useState(false)
  const [rechercheKey, setRechercheKey] = useState<string | null>(null)
  // Suppression d'article (point 12, vague 2) : cible en attente de confirmation
  // ({sIdx, aIdx, libelle}) ; non null => pop-up de confirmation affiche.
  const [suppressionCible, setSuppressionCible] = useState<
    { sIdx: number; aIdx: number; libelle: string } | null
  >(null)
  const [suppression, setSuppression] = useState(false)
  // Suppression d'une SECTION entiere (commit 3) : cible en attente de confirmation
  // ({sIdx, nom}) ; non null => pop-up affiche. Verrou distinct de la suppression
  // d'article et du drapeau de section nouvelle.
  const [suppressionSectionCible, setSuppressionSectionCible] = useState<
    { sIdx: number; nom: string } | null
  >(null)
  const [suppressionSection, setSuppressionSection] = useState(false)

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
    annulerEditionSection()
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

  // ---------- Phase A : renommage de section ----------

  // Ouvre le renommage d'une section : on ferme toute edition/recherche d'article
  // ouverte (operation structurelle : on evite des cles d'index incoherentes) et
  // on pre-remplit le brouillon avec le nom actuel.
  function ouvrirEditionSection(sIdx: number, nom: string) {
    setEditingKey(null)
    setRechercheKey(null)
    setEditSectionIdx(sIdx)
    setEditSectionDraft(nom)
  }

  function annulerEditionSection() {
    setEditSectionIdx(null)
    setEditSectionDraft('')
  }

  // Enregistre le nouveau titre de la section : met a jour le state local, persiste
  // via la route metres-vocaux (mode save, sans audio) et rollback si l'enregistrement
  // echoue (meme patron que sauverDescription / choisirRemplacement). Un titre vide
  // est refuse en amont (bouton desactive), garde-fou ici par securite.
  async function sauverTitreSection(sIdx: number) {
    if (savingSection) return
    const titre = editSectionDraft.trim()
    if (!titre) return
    // Sauvegarde explicite : on annule un auto-save en attente (cet envoi porte
    // l'etat complet, quantites comprises).
    annulerAutoSave()
    // Renommage d'une section = vraie modification.
    aModifieRef.current = true
    setSavingSection(true)
    const precedentes = sections
    const sectionsMaj = sections.map((s, i) => (i === sIdx ? { ...s, nom: titre } : s))

    setSections(sectionsMaj)

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
      // Premier enregistrement du titre = section confirmee : « Annuler » ne la
      // supprimera plus a l'avenir.
      if (sIdx === sectionNouvelleIdx) setSectionNouvelleIdx(null)
      annulerEditionSection()
      toast.show('Section renommée', 'success')
    } catch (e) {
      // Rollback : on restaure l'etat d'avant si la persistance a echoue.
      setSections(precedentes)
      toast.show((e as Error).message ?? 'Échec du renommage', 'error')
    } finally {
      setSavingSection(false)
    }
  }

  // ---------- Phase A : ajout d'une section (commit 2) ----------

  // Ajoute une nouvelle section VIDE en bas de la liste, la persiste (mode save +
  // rollback, meme patron que le reste) et l'ouvre IMMEDIATEMENT en renommage pour
  // qu'Olivier la nomme tout de suite. Il y ajoutera ensuite des articles via le
  // « + Ajouter un article » existant.
  async function ajouterSection() {
    if (savingSection) return
    // Operation structurelle : on ferme toute edition/recherche d'article ouverte.
    setEditingKey(null)
    setRechercheKey(null)
    // Sauvegarde explicite : on annule un auto-save en attente.
    annulerAutoSave()
    // Ajout d'une section = vraie modification.
    aModifieRef.current = true
    setSavingSection(true)
    const precedentes = sections
    const nouvelIdx = sections.length
    const sectionsMaj: SectionDevis[] = [...sections, { nom: 'Nouvelle section', articles: [] }]

    setSections(sectionsMaj)
    // Ouvre la nouvelle section en renommage (le champ titre prend le focus) et la
    // marque « non confirmee » : « Annuler » la retirera tant qu'elle ne l'est pas.
    setEditSectionIdx(nouvelIdx)
    setEditSectionDraft('Nouvelle section')
    setSectionNouvelleIdx(nouvelIdx)

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
      toast.show('Section ajoutée', 'success')
    } catch (e) {
      // Rollback : on retire la section ajoutee, on referme le renommage et on
      // oublie le marquage « non confirmee » (la section n'existe plus).
      setSections(precedentes)
      annulerEditionSection()
      setSectionNouvelleIdx(null)
      toast.show((e as Error).message ?? 'Échec de l\'ajout', 'error')
    } finally {
      setSavingSection(false)
    }
  }

  // Annulation du renommage d'une section qu'on VIENT DE CREER (non confirmee) :
  // « Annuler » renonce a l'ajout, donc on RETIRE la section et on persiste la
  // suppression (mode save + rollback, meme patron que le reste). Aucune trace
  // residuelle d'une section vide « Nouvelle section ».
  async function annulerAjoutSection(sIdx: number) {
    if (savingSection) return
    annulerAutoSave()
    aModifieRef.current = true
    setSavingSection(true)
    const precedentes = sections
    const sectionsMaj = sections.filter((_, i) => i !== sIdx)

    setSections(sectionsMaj)
    annulerEditionSection()
    setSectionNouvelleIdx(null)
    // Index modifies : on ferme toute edition/recherche d'article ouverte.
    setEditingKey(null)
    setRechercheKey(null)

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
    } catch (e) {
      // Rollback : la section revient (renommage referme) si la persistance echoue.
      setSections(precedentes)
      toast.show((e as Error).message ?? 'Échec de l\'annulation', 'error')
    } finally {
      setSavingSection(false)
    }
  }

  // « Annuler » du renommage : si la section editee est la nouvelle non confirmee,
  // on la retire (annulation de l'ajout) ; sinon on referme simplement le renommage
  // (section preexistante, ancien titre conserve). Sert au bouton « Annuler ».
  function annulerRenommageSection() {
    const idx = editSectionIdx
    if (idx != null && idx === sectionNouvelleIdx) {
      void annulerAjoutSection(idx)
      return
    }
    annulerEditionSection()
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
    annulerEditionSection()
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

  // ---------- Phase A : ajout d'article (point 12, vague 2) ----------
  // Cle de barre de recherche distincte du remplacement (`sIdx::aIdx`) : on
  // prefixe `add::` + l'index de section pour ne pas confondre quelle barre est
  // ouverte.
  function ouvrirAjout(sIdx: number) {
    annulerEdition()
    annulerEditionSection()
    setRechercheKey(`add::${sIdx}`)
    void chargerBiblio()
  }

  // Ajoute un NOUVEL article (choisi dans la bibliotheque) a la section : on
  // reprend libelle, unite et prix unitaire du catalogue ; quantite = null
  // (saisie en Phase B) ; description = libelle en repli (reeditable ensuite).
  // Persistance via la route existante (mode save) + rollback (meme patron que
  // choisirRemplacement). Anti-hallucination : c'est un VRAI article du catalogue.
  async function ajouterArticle(sIdx: number, article: ArticleRemplacable) {
    annulerAutoSave()
    aModifieRef.current = true
    // Ajouter un article a une section la confirme : « Annuler » un futur renommage
    // ne la supprimera plus.
    if (sIdx === sectionNouvelleIdx) setSectionNouvelleIdx(null)
    const precedentes = sections
    const nouvel: ArticleDevis = {
      costructor_article_id: article.costructor_article_id,
      libelle: article.libelle,
      unite: article.unite,
      prix_vente: article.prix_vente,
      quantite: null,
      description_technique: article.libelle,
    }
    const sectionsMaj = sections.map((s, i) =>
      i === sIdx ? { ...s, articles: [...s.articles, nouvel] } : s,
    )

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
      toast.show('Article ajouté', 'success')
    } catch (e) {
      // Rollback : on restaure l'etat d'avant si la persistance a echoue.
      setSections(precedentes)
      toast.show((e as Error).message ?? 'Échec de l\'ajout', 'error')
    }
  }

  // ---------- Phase A : suppression d'article (point 12, vague 2) ----------

  // Supprime l'article cible apres confirmation : retire la ligne (et la SECTION
  // si elle devient vide), persiste via la route metres-vocaux (mode save) et
  // rollback si l'enregistrement echoue (meme patron que choisirRemplacement).
  async function confirmerSuppression() {
    if (!suppressionCible || suppression) return
    const { sIdx, aIdx } = suppressionCible
    // Sauvegarde explicite : on annule un auto-save en attente.
    annulerAutoSave()
    setSuppression(true)
    const precedentes = sections
    // Retire l'article ; si la section n'a plus d'article, on retire la section.
    const sectionsMaj = sections
      .map((s, i) => {
        if (i !== sIdx) return s
        return { ...s, articles: s.articles.filter((_, j) => j !== aIdx) }
      })
      .filter((s) => s.articles.length > 0)

    setSections(sectionsMaj)
    setSuppressionCible(null)
    // Les index changent apres suppression : on ferme toute edition/recherche
    // d'article ouverte pour ne pas viser une cle d'index perimee.
    setEditingKey(null)
    setRechercheKey(null)

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
      toast.show('Article supprimé', 'success')
    } catch (e) {
      // Rollback : on restaure l'etat d'avant si la persistance a echoue.
      setSections(precedentes)
      toast.show((e as Error).message ?? 'Échec de la suppression', 'error')
    } finally {
      setSuppression(false)
    }
  }

  // ---------- Phase A : suppression d'une section entiere (commit 3) ----------

  // Supprime la section cible (et donc TOUS ses articles) apres confirmation :
  // retire la section, persiste via la route metres-vocaux (mode save) et rollback
  // si l'enregistrement echoue (meme patron que la suppression d'article). Supprimer
  // la derniere section est autorise (la garde total-0 empeche d'envoyer un devis
  // vide, et « + Ajouter une section » reste visible).
  async function confirmerSuppressionSection() {
    if (!suppressionSectionCible || suppressionSection) return
    const { sIdx } = suppressionSectionCible
    // Sauvegarde explicite : on annule un auto-save en attente.
    annulerAutoSave()
    aModifieRef.current = true
    setSuppressionSection(true)
    const precedentes = sections
    const sectionsMaj = sections.filter((_, i) => i !== sIdx)

    setSections(sectionsMaj)
    setSuppressionSectionCible(null)
    // Les index des sections SUIVANTES sont decales : on ferme toute edition/recherche
    // d'article et l'edition de titre ouvertes pour ne viser aucune cle perimee.
    setEditingKey(null)
    setRechercheKey(null)
    annulerEditionSection()
    // Recale le drapeau « section nouvelle non confirmee » selon la suppression :
    // supprimee -> oubli ; section avant elle supprimee -> son index recule de 1.
    setSectionNouvelleIdx((prev) => {
      if (prev == null) return null
      if (prev === sIdx) return null
      if (sIdx < prev) return prev - 1
      return prev
    })

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
      toast.show('Section supprimée', 'success')
    } catch (e) {
      // Rollback : on restaure l'etat d'avant si la persistance a echoue.
      setSections(precedentes)
      toast.show((e as Error).message ?? 'Échec de la suppression', 'error')
    } finally {
      setSuppressionSection(false)
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
              {/* En-tete de section : titre + renommage inline (commit 1). */}
              {editSectionIdx === sIdx ? (
                <div className="mb-3 space-y-2">
                  <input
                    type="text"
                    value={editSectionDraft}
                    onChange={(e) => setEditSectionDraft(e.target.value)}
                    className="input-ionnyx w-full text-sm font-bold uppercase tracking-wide text-primary"
                    placeholder="Nom de la section..."
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={annulerRenommageSection}
                      disabled={savingSection}
                      className="btn-tertiary text-xs px-3 py-1.5"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={() => sauverTitreSection(sIdx)}
                      disabled={savingSection || !editSectionDraft.trim()}
                      className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
                    >
                      {savingSection && <Spinner className="h-3 w-3" />}
                      Enregistrer
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-primary">
                    {s.nom}
                  </h2>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => ouvrirEditionSection(sIdx, s.nom)}
                      className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                      </svg>
                      Renommer la section
                    </button>
                    <button
                      type="button"
                      onClick={() => setSuppressionSectionCible({ sIdx, nom: s.nom })}
                      className="text-[11px] text-red-600 hover:underline inline-flex items-center gap-1"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                      Supprimer la section
                    </button>
                  </div>
                </div>
              )}
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
                            <button
                              type="button"
                              onClick={() => setSuppressionCible({ sIdx, aIdx, libelle: a.libelle })}
                              className="text-[11px] text-red-600 hover:underline inline-flex items-center gap-1"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                              Supprimer l&apos;article
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

              {/* Ajout d'un article a cette section (point 12) : meme
                  autocompletion sur la bibliotheque que « Remplacer l'article ». */}
              <div className="mt-4 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => ouvrirAjout(sIdx)}
                  className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Ajouter un article
                </button>
                {rechercheKey === `add::${sIdx}` && (
                  <RechercheArticle
                    articles={articlesBiblio}
                    chargement={chargementBiblio}
                    onChoisir={(article) => ajouterArticle(sIdx, article)}
                    onFermer={fermerRecherche}
                  />
                )}
              </div>
            </section>
          ))}

          {/* Ajout d'une nouvelle section (commit 2) : HORS du map ci-dessus, donc
              toujours visible, y compris quand il ne reste aucune section. */}
          <button
            type="button"
            onClick={ajouterSection}
            disabled={savingSection}
            className="w-full rounded-2xl border border-dashed border-primary/40 bg-primary/5 py-3 text-sm font-medium text-primary hover:bg-primary/10 transition inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Ajouter une section
          </button>
        </main>

        {/* Pop-up de confirmation de suppression (point 12, style coherent avec
            DeleteChantierModal). */}
        {suppressionCible && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => { if (!suppression) setSuppressionCible(null) }}
            />
            <div className="relative w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-6 pb-safe animate-slide-up sm:animate-scale-in">
              <h3 className="text-lg font-bold text-foreground mb-2">
                Supprimer cet article ?
              </h3>
              <p className="text-gray-500 text-sm mb-6">
                L&apos;article <span className="font-medium text-foreground">&quot;{suppressionCible.libelle}&quot;</span> sera
                retiré du devis.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setSuppressionCible(null)}
                  disabled={suppression}
                  className="btn-tertiary flex-1"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={confirmerSuppression}
                  disabled={suppression}
                  className="flex-1 inline-flex items-center justify-center rounded-xl px-6 py-3 bg-red-600 text-white font-semibold transition-all active:scale-97 disabled:opacity-50"
                >
                  {suppression ? 'Suppression...' : 'Supprimer'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Pop-up de confirmation de suppression d'une SECTION entiere (commit 3,
            meme style que la suppression d'article). */}
        {suppressionSectionCible && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => { if (!suppressionSection) setSuppressionSectionCible(null) }}
            />
            <div className="relative w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-6 pb-safe animate-slide-up sm:animate-scale-in">
              <h3 className="text-lg font-bold text-foreground mb-2">
                Supprimer cette section ?
              </h3>
              <p className="text-gray-500 text-sm mb-6">
                La section <span className="font-medium text-foreground">&quot;{suppressionSectionCible.nom}&quot;</span> et
                tous ses articles seront retirés du devis.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setSuppressionSectionCible(null)}
                  disabled={suppressionSection}
                  className="btn-tertiary flex-1"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={confirmerSuppressionSection}
                  disabled={suppressionSection}
                  className="flex-1 inline-flex items-center justify-center rounded-xl px-6 py-3 bg-red-600 text-white font-semibold transition-all active:scale-97 disabled:opacity-50"
                >
                  {suppressionSection ? 'Suppression...' : 'Supprimer'}
                </button>
              </div>
            </div>
          </div>
        )}

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
      {/* Fleche retour (point 13) EN TETE A GAUCHE, pleine largeur (comme le
          header), au meme emplacement que « Saisir les metres » du recap. Vert
          (text-primary) et un peu plus gros pour la visibilite. Action inchangee :
          revient a la proposition technique (Phase A). */}
      <div className="flex-shrink-0 px-5 pt-3">
        <button
          type="button"
          onClick={() => setPhase('technique')}
          className="flex items-center gap-1.5 -ml-1 p-1 text-primary hover:text-primary/80 transition-colors"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span className="text-sm font-medium">Revenir à la proposition technique</span>
        </button>
      </div>

      <main className="flex-1 overflow-y-auto px-5 pt-2 pb-44 max-w-2xl mx-auto w-full">
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
