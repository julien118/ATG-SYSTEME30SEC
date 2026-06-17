'use client'

// =============================================================
// Assistant de consultation des devis (widget de chat flottant)
// =============================================================
// Bouton flottant en bas a droite ; au clic, une fenetre de chat s'ouvre avec un
// accueil et des exemples cliquables. Olivier pose ses questions, le bot repond
// via /api/assistant-devis (qui appelle le moteur lib/devis-historique.ts).
//
// LECTURE SEULE : le widget ne fait qu'interroger et afficher. Aucun stockage
// navigateur (etat React uniquement, pas de localStorage).

import { useEffect, useRef, useState } from 'react'
import AudioRecorder from './AudioRecorder'

// Candidat cliquable (amelioration 4) : forme renvoyee par l'API quand un nom est
// ambigu. `valeur` = nom canonique exact a renvoyer en clientForce au clic.
interface Candidat {
  libelle: string
  valeur: string
  ville: string | null
  origine: 'costructor' | 'app'
}

interface Message {
  id: number
  role: 'user' | 'bot'
  texte: string
  // Boutons de desambiguisation affiches sous une bulle bot (amelioration 4). On
  // memorise aussi la question d'origine a rejouer et le domaine d'origine, pour
  // que le clic relance la bonne question sur le bon domaine.
  candidats?: Candidat[]
  questionOrigine?: string
  domaine?: string
}

const EXEMPLES = [
  'Mon prix moyen sur les ravalements',
  'Mes 3 plus gros devis',
  'Qu\'ai-je noté chez M. Dupont ?',
  'L\'adresse de M. Dupont',
]

// Accueil formule par briques (les sources consultables), pour pouvoir y ajouter
// de nouveaux domaines sans tout reecrire.
const SOURCES_CONSULTABLES = 'vos devis, vos comptes rendus de visite et vos clients'
const ACCUEIL =
  `Bonjour Olivier, que souhaitez-vous savoir ? Je peux consulter ${SOURCES_CONSULTABLES}.`

// Convertit le texte du bot (sauts de ligne + **gras**) en elements React, sans
// injection HTML (on construit les noeuds nous-memes).
function formaterLigne(ligne: string) {
  return ligne.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}
function formaterTexte(texte: string) {
  return texte.split('\n').map((ligne, i) =>
    ligne.trim() === '' ? (
      <div key={i} className="h-2" />
    ) : (
      <p key={i}>{formaterLigne(ligne)}</p>
    ),
  )
}

// Construit le transcript de la conversation en cours (memoire conversationnelle,
// commit 2) envoye a chaque requete EN PLUS de dernierClient. Borne le volume comme
// le backend (8 derniers messages, reponses bot tronquees) pour ne pas exploser le
// payload. Sert UNIQUEMENT a la comprehension cote serveur, jamais a la redaction.
// Vide en debut de conversation => comportement inchange.
const MAX_HISTORIQUE = 8
const MAX_BOT_HISTO = 400
const MAX_USER_HISTO = 300
function tronquerHisto(s: string, max: number): string {
  const t = (s ?? '').trim()
  return t.length > max ? `${t.slice(0, max).trimEnd()}...` : t
}
function construireHistorique(msgs: Message[]): { role: 'user' | 'bot'; texte: string }[] {
  return msgs
    .slice(-MAX_HISTORIQUE)
    .filter((m) => m.texte && m.texte.trim())
    .map((m) => ({
      role: m.role,
      texte: tronquerHisto(m.texte, m.role === 'bot' ? MAX_BOT_HISTO : MAX_USER_HISTO),
    }))
}

export default function AssistantDevis() {
  const [ouvert, setOuvert] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [saisie, setSaisie] = useState('')
  const [reflexion, setReflexion] = useState(false)
  // Etat de la dictee : transcription en cours, et message discret eventuel
  // (micro refuse ou transcription echouee). Le champ reste utilisable au clavier.
  const [transcription, setTranscription] = useState(false)
  const [erreurVocal, setErreurVocal] = useState('')
  // Contexte de conversation (amelioration 3) : dernier client evoque, renvoye par
  // l'API et re-transmis a la question suivante pour resoudre les suivis (« et son
  // adresse ? »). Vit avec la conversation (remis a zero au remontage du widget).
  const [dernierClient, setDernierClient] = useState<string | null>(null)
  const compteur = useRef(0)
  const finRef = useRef<HTMLDivElement>(null)
  const champRef = useRef<HTMLInputElement>(null)

  // Defile en bas a chaque nouveau message / pendant la reflexion.
  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, reflexion])

  // Focus sur le champ a l'ouverture.
  useEffect(() => {
    if (ouvert) champRef.current?.focus()
  }, [ouvert])

  // Coeur d'un echange : affiche une bulle utilisateur, appelle l'API et affiche la
  // reponse du bot. `corps` est le corps de la requete (question + eventuels
  // clientForce/domaineForce pour un clic sur un candidat). On memorise sur la bulle
  // bot les candidats renvoyes + la question d'origine + le domaine, pour les boutons.
  async function poser(
    corps: { question: string; clientForce?: string; domaineForce?: string },
    texteUtilisateur: string,
  ) {
    if (reflexion) return
    // Transcript de la conversation ANTERIEURE (avant la question courante) : on le
    // calcule depuis l'etat actuel des messages, AVANT d'ajouter la bulle utilisateur.
    const historique = construireHistorique(messages)
    setMessages((m) => [...m, { id: compteur.current++, role: 'user', texte: texteUtilisateur }])
    setReflexion(true)
    try {
      const res = await fetch('/api/assistant-devis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // On transmet le dernier client evoque (suivis « et son adresse ? ») ET le
        // fil de la conversation (references au passe « le compte rendu dont on
        // parlait ? »). L'historique ne sert qu'a la comprehension cote serveur.
        body: JSON.stringify({ ...corps, dernierClient, historique }),
      })
      const data = await res.json().catch(() => ({}))
      const reponse =
        res.ok && data.reponse
          ? data.reponse
          : data.error || 'Désolé, je n\'ai pas pu répondre.'
      const candidats = Array.isArray(data.candidats) ? (data.candidats as Candidat[]) : undefined
      setMessages((m) => [
        ...m,
        {
          id: compteur.current++,
          role: 'bot',
          texte: reponse,
          candidats,
          questionOrigine: corps.question,
          domaine: typeof data.domaine === 'string' ? data.domaine : undefined,
        },
      ])
      // On met a jour le contexte UNIQUEMENT si l'API a resolu un client (non null) :
      // une question generale renvoie null et on conserve alors le contexte courant.
      if (typeof data.clientContexte === 'string' && data.clientContexte) {
        setDernierClient(data.clientContexte)
      }
    } catch {
      setMessages((m) => [
        ...m,
        { id: compteur.current++, role: 'bot', texte: 'Désolé, je n\'ai pas pu répondre. Vérifiez la connexion.' },
      ])
    } finally {
      setReflexion(false)
    }
  }

  async function envoyer(texte: string) {
    const question = texte.trim()
    if (!question || reflexion) return
    setSaisie('')
    await poser({ question }, question)
  }

  // Clic sur un candidat (amelioration 4) : on REJOUE la question d'origine en
  // forçant le client choisi (clientForce = nom canonique exact) et le domaine
  // d'origine. L'intention (adresse, recap...) est preservee car la question
  // d'origine est rejouee telle quelle ; seul le « qui » est force.
  function choisirCandidat(candidat: Candidat, questionOrigine: string, domaine: string) {
    if (reflexion) return
    const texteUtilisateur = candidat.ville ? `${candidat.libelle}, ${candidat.ville}` : candidat.libelle
    void poser(
      { question: questionOrigine, clientForce: candidat.valeur, domaineForce: domaine },
      texteUtilisateur,
    )
  }

  // Dictee vocale : on envoie le blob au MEME endpoint que les notes de visite
  // (/api/transcribe, qui applique le helper du lot 2 : prompt metier + reponctuation).
  // LECTURE SEULE : aucune ecriture Supabase, on ne persiste rien, on remplit juste
  // le champ. Le texte transcrit est ajoute au champ (modifiable), jamais envoye
  // automatiquement : Olivier relit et corrige avant d'envoyer.
  async function transcrire(blob: Blob) {
    if (blob.size < 1000) {
      setErreurVocal('Enregistrement trop court.')
      return
    }
    setErreurVocal('')
    setTranscription(true)
    try {
      const formData = new FormData()
      formData.append('audio', blob, 'question.webm')
      const res = await fetch('/api/transcribe', { method: 'POST', body: formData })
      const data = await res.json().catch(() => ({}))
      const texte = (data.text ?? '').trim()
      if (res.ok && texte) {
        // Concatene proprement au texte deja saisi plutot que d'ecraser.
        setSaisie((prev) => (prev.trim() ? `${prev.trim()} ${texte}` : texte))
      } else {
        setErreurVocal('Transcription échouée. Réessayez ou tapez votre question.')
      }
    } catch {
      setErreurVocal('Transcription échouée. Réessayez ou tapez votre question.')
    } finally {
      setTranscription(false)
      // Redonne la main au champ pour la relecture et la correction.
      champRef.current?.focus()
    }
  }

  return (
    <>
      {/* Bouton flottant */}
      {!ouvert && (
        <button
          onClick={() => setOuvert(true)}
          aria-label="Ouvrir l'assistant ATG"
          // Discret au repos (un peu plus petit, semi-transparent), pleine
          // presence au survol / focus / contact tactile.
          className="fixed right-5 z-50 h-12 w-12 rounded-full bg-primary text-white shadow-md shadow-primary/30 flex items-center justify-center opacity-70 hover:opacity-100 focus-visible:opacity-100 active:opacity-100 hover:bg-primary-dark active:scale-95 transition animate-scale-in"
          // Empilee AU-DESSUS du bouton "ajouter une visite" (bottom-8 = 32px,
          // marge mb-safe = max(12px, safe-area), hauteur 56px) avec un ecart
          // constant de 16px : 32 + 56 + 16 = 104px (6.5rem), plus le MEME socle
          // mb-safe pour que l'ecart reste de 16px avec ou sans safe-area iOS.
          // Ainsi la pastille ne chevauche jamais le bouton d'ajout (prioritaire)
          // ni les barres CTA en bas de page.
          style={{ bottom: 'calc(6.5rem + max(12px, env(safe-area-inset-bottom)))' }}
        >
          <IconeBot className="h-6 w-6" />
        </button>
      )}

      {/* Fenetre de chat */}
      {ouvert && (
        <div
          className="fixed z-50 inset-x-3 bottom-3 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[384px] flex flex-col rounded-2xl bg-white shadow-2xl border border-border overflow-hidden animate-scale-in"
          style={{
            height: 'min(78vh, 600px)',
            marginBottom: 'env(safe-area-inset-bottom)',
          }}
          role="dialog"
          aria-label="Assistant ATG"
        >
          {/* En-tete */}
          <div className="flex items-center gap-3 bg-header text-white px-4 py-3">
            <div className="h-9 w-9 rounded-full bg-primary flex items-center justify-center shrink-0">
              <IconeBot className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">Assistant ATG</p>
            </div>
            <button
              onClick={() => setOuvert(false)}
              aria-label="Fermer"
              className="text-white/70 hover:text-white p-1"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Conversation */}
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-3 bg-background">
            {/* Accueil */}
            <Bulle role="bot">{ACCUEIL}</Bulle>

            {/* Exemples cliquables (tant qu'aucune question n'a ete posee) */}
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2 pl-1">
                {EXEMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => envoyer(ex)}
                    className="text-xs text-primary-dark bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-full px-3 py-1.5 transition active:scale-95"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className="space-y-2">
                <Bulle role={m.role}>
                  {m.role === 'bot' ? formaterTexte(m.texte) : m.texte}
                </Bulle>
                {/* Boutons de desambiguisation (amelioration 4) : uniquement sous une
                    bulle bot porteuse de candidats. Construits a partir des donnees
                    renvoyees par l'API (jamais inventes). */}
                {m.role === 'bot' && m.candidats && m.candidats.length > 0 && (
                  <div className="flex flex-col gap-2 pl-1">
                    {m.candidats.map((c, i) => (
                      <button
                        key={`${m.id}-${i}`}
                        onClick={() => choisirCandidat(c, m.questionOrigine ?? '', m.domaine ?? 'clients')}
                        disabled={reflexion}
                        className="flex items-center justify-between gap-2 text-left bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-xl px-3 py-2 transition active:scale-[0.98] disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-foreground truncate">{c.libelle}</span>
                          {c.ville && (
                            <span className="block text-xs text-gray-500 truncate">{c.ville}</span>
                          )}
                        </span>
                        {c.origine === 'app' && (
                          <span className="shrink-0 text-[10px] font-medium text-primary-dark bg-primary/15 border border-primary/20 rounded-full px-2 py-0.5">
                            fiche app
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Indicateur de reflexion */}
            {reflexion && (
              <div className="flex justify-start">
                <div className="bg-white border border-border rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
                  <span className="flex gap-1">
                    <Point delai="0ms" /><Point delai="150ms" /><Point delai="300ms" />
                  </span>
                </div>
              </div>
            )}

            <div ref={finRef} />
          </div>

          {/* Saisie */}
          <form
            onSubmit={(e) => { e.preventDefault(); envoyer(saisie) }}
            className="flex flex-col gap-1.5 border-t border-border bg-white px-3 py-2.5"
          >
            {/* Message discret : micro refuse ou transcription echouee. */}
            {erreurVocal && (
              <p className="text-[11px] text-red-600 px-1" role="status">
                {erreurVocal}
              </p>
            )}
            <div className="flex items-center gap-2">
            <input
              ref={champRef}
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              placeholder={transcription ? 'Transcription en cours...' : 'Posez votre question...'}
              className="flex-1 min-w-0 rounded-full bg-input-bg border border-border focus:border-primary focus:bg-input-focus outline-none px-4 py-2.5 text-sm"
              enterKeyHint="send"
            />
            {/* Dictee vocale : meme mecanique micro que la visite (variante compacte),
                meme endpoint de transcription. Desactivee pendant la reflexion du bot
                ou une transcription deja en cours. */}
            <AudioRecorder
              variant="compact"
              onRecordingComplete={transcrire}
              onError={setErreurVocal}
              disabled={reflexion || transcription}
            />
            <button
              type="submit"
              disabled={!saisie.trim() || reflexion || transcription}
              aria-label="Envoyer"
              className="h-10 w-10 shrink-0 rounded-full bg-primary text-white flex items-center justify-center disabled:opacity-40 enabled:hover:bg-primary-dark enabled:active:scale-95 transition"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

// ---------- Sous-composants ----------

function Bulle({ role, children }: { role: 'user' | 'bot'; children: React.ReactNode }) {
  const estUser = role === 'user'
  return (
    <div className={`flex ${estUser ? 'justify-end' : 'justify-start'} animate-card-appear`}>
      <div
        className={`max-w-[85%] px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
          estUser
            ? 'bg-primary text-white rounded-2xl rounded-br-md'
            : 'bg-white text-foreground border border-border rounded-2xl rounded-bl-md'
        }`}
      >
        {children}
      </div>
    </div>
  )
}

function Point({ delai }: { delai: string }) {
  return (
    <span
      className="h-2 w-2 rounded-full bg-primary/60 animate-bounce"
      style={{ animationDelay: delai }}
    />
  )
}

function IconeBot({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
      <line x1="8" y1="16" x2="8" y2="16" />
      <line x1="16" y1="16" x2="16" y2="16" />
    </svg>
  )
}
