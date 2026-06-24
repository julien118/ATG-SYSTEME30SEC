// =============================================================
// Transcription vocale (lot 2) — moteur + reponctuation prudente
// =============================================================
// Deux briques, partagees par /api/transcribe (notes de visite) et
// /api/devis/metres-vocaux (metres dictes) :
//
//  1. `transcrireAudio` : appel Groq Whisper turbo avec un PROMPT METIER (biaise
//     l'orthographe du vocabulaire batiment d'Olivier et la ponctuation) et
//     `temperature: 0` (sortie litterale, pas de paraphrase). Risque de fidelite
//     nul : le prompt ne fait qu'orienter, c'est l'audio qui dicte le contenu.
//
//  2. `reponctuer` : passe Claude qui AJOUTE uniquement ponctuation, majuscules et
//     accents, SANS jamais changer un mot, un terme technique ou une mesure. La
//     garantie ne repose pas sur la bonne volonte du modele mais sur un GARDE-FOU
//     programmatique (`gardeFouFidelite`) : si le squelette alphanumerique ou la
//     suite des nombres differe, on JETTE la passe et on garde le texte brut.
//     Fail-open : toute erreur/timeout retombe aussi sur le brut.

import Groq from 'groq-sdk'
import { anthropic, MODELE_CLAUDE } from './anthropic'

const MODELE_WHISPER = 'whisper-large-v3-turbo'
const MODELE_REPONCTUATION = MODELE_CLAUDE
// Timeouts dimensionnes pour absorber un enregistrement long (jusqu'a ~5 min,
// le garde-fou de duree cote AudioRecorder) : Whisper turbo reste rapide mais on
// laisse une marge confortable pour l'upload + la transcription, et la
// reponctuation a le temps de traiter un texte plus long.
const TIMEOUT_WHISPER_MS = 120000
const TIMEOUT_REPONCTUATION_MS = 20000

// Prompt metier Whisper : texte court (cap ~224 tokens cote Whisper), BIEN ponctue
// et accentue (Whisper calque ce style), truffe du vocabulaire et des marques
// d'Olivier (tire de STYLE-OLIVIER.md + lib/atg-devis-modele.ts) pour que le moteur
// ecrive "taloche", "I4", "Baumit StarSystem" correctement plutot que de les
// transformer en mots courants.
export const PROMPT_METIER_WHISPER =
  "Compte rendu de visite technique de ravalement de façade et d'isolation thermique par l'extérieur. " +
  'Vocabulaire : ravalement, enduit taloché, finition I3, finition I4, entoilage, marouflage du voile, ' +
  'soubassement, appuis de fenêtres, dessous de toit, corniche, tableaux et voussures, couvertine, ' +
  "souche de cheminée, descente d'eaux pluviales, échafaudage Comabi, lavage haute pression, " +
  'traitement algicide et fongicide, polystyrène PSE, fissures. ' +
  'Marques : Baumit StarSystem, Virtuotech, Applitech, Weber, Knauf, Sigmasol, ACERMI, DTU. ' +
  'Les mesures sont en mètres carrés, mètres linéaires et millimètres.'

// Transcrit un fichier audio via Groq Whisper turbo (langue francaise), avec le
// prompt metier et temperature 0. Timeout dur pour ne pas bloquer le terrain.
export async function transcrireAudio(audio: File): Promise<string> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_WHISPER_MS)
  try {
    const t = await groq.audio.transcriptions.create(
      {
        file: audio,
        model: MODELE_WHISPER,
        language: 'fr',
        response_format: 'json',
        prompt: PROMPT_METIER_WHISPER,
        temperature: 0,
      },
      { signal: controller.signal },
    )
    return (t as { text?: string }).text ?? ''
  } finally {
    clearTimeout(timer)
  }
}

// ---------- Reponctuation prudente (verrous de fidelite) ----------

// Squelette alphanumerique : minuscules, accents retires, tout caractere non
// alphanumerique supprime. Deux textes identiques apres normalisation ne different
// QUE par la ponctuation, la casse, les accents et les espaces — donc aucun mot
// ni chiffre n'a ete change, ajoute ou retire.
function normaliserSquelette(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

// Suite ordonnee des nombres/mesures (chiffres avec leur separateur decimal
// interne, ex "5,36" ou "4.50"). Sert a garantir qu'aucune mesure n'a bouge :
// le squelette seul laisserait passer "5,36" -> "536" (meme suite de chiffres).
function extraireNombres(s: string): string[] {
  return (s ?? '').match(/\d+(?:[.,]\d+)*/g) ?? []
}

// GARDE-FOU de fidelite (fonction pure, testable sans appel reseau). Renvoie la
// sortie reponctuee SEULEMENT si elle ne differe du brut que par la ponctuation /
// casse / accents ET que la suite des nombres est strictement identique. Sinon on
// retombe sur le brut. C'est la garantie : jamais un mot technique (I3, taloché,
// une marque) ni une mesure ne peut etre alteree en silence.
export function gardeFouFidelite(
  brut: string,
  sortie: string,
): { ok: boolean; texte: string } {
  const sortieNette = (sortie ?? '').trim()
  if (!sortieNette) return { ok: false, texte: brut }
  if (normaliserSquelette(sortieNette) !== normaliserSquelette(brut)) {
    return { ok: false, texte: brut }
  }
  if (extraireNombres(sortieNette).join('|') !== extraireNombres(brut).join('|')) {
    return { ok: false, texte: brut }
  }
  return { ok: true, texte: sortieNette }
}

const SYSTEME_REPONCTUATION = `Tu reçois une note vocale transcrite, dictée sur un chantier par un professionnel du ravalement de façade et de l'isolation thermique par l'extérieur. La transcription manque de ponctuation et de majuscules.

Ta SEULE tâche : ajouter la ponctuation, les majuscules en début de phrase et les accents oubliés pour rendre le texte lisible.

INTERDICTIONS ABSOLUES :
- Ne change, n'ajoute, ne supprime, ne réordonne AUCUN mot.
- Ne touche à AUCUN chiffre, AUCUNE mesure, AUCUNE unité. "5,36 m", "12 m²", "140 mm", "R=4.50" restent identiques au caractère près.
- Ne "corrige" PAS le vocabulaire technique ni les marques : I3, I4, taloché, entoilage, marouflage, soubassement, couvertine, PSE, Baumit, StarSystem, Virtuotech, Applitech, Weber, Knauf, Sigmasol, ACERMI, DTU se conservent tels quels.
- Ne reformule pas, ne traduis pas, ne résume pas, n'explique pas, n'ajoute aucun commentaire.

Tu te limites STRICTEMENT à la ponctuation, aux majuscules et aux accents. En cas de doute, laisse tel quel.

Renvoie UNIQUEMENT le texte reponctué, sans guillemets ni commentaire.`

// ---------- Nettoyage de dictee (support / tickets) ----------
// Contrairement a `reponctuer` (verrouille pour les notes de visite ou chaque mot
// et mesure comptent), ce nettoyage est destine aux MESSAGES DE SUPPORT : on
// privilegie la lisibilite. Il SUPPRIME les mots parasites ("euh", "bah"...) et
// les hesitations, et nettoie la ponctuation, sans changer le sens. Pas de
// garde-fou de fidelite (on veut justement retirer des mots). Fail-open : tout
// echec/timeout retombe sur le texte brut.
const SYSTEME_NETTOYAGE = `Tu reçois une note vocale transcrite, dictée par un artisan pour un message de support. Nettoie-la pour qu'elle soit claire et professionnelle à l'écrit, SANS en changer le sens.

À FAIRE :
- Supprime les mots parasites et hésitations : « euh », « bah », « ben », « hum », « heu », les « voilà » et « du coup » de remplissage, les faux départs et répétitions involontaires.
- Ajoute la ponctuation, les majuscules et les accents ; corrige les évidences de transcription.
- Conserve toutes les informations, les chiffres et le ton.

À NE PAS FAIRE :
- N'invente rien, n'ajoute aucune information, ne change aucun chiffre ni mesure.
- Pas de commentaire ni de guillemets.

Renvoie UNIQUEMENT le texte nettoyé.`

export async function nettoyerDictee(texteBrut: string): Promise<string> {
  const brut = (texteBrut ?? '').trim()
  if (!brut) return texteBrut ?? ''
  try {
    const reponse = await anthropic.messages.create(
      {
        model: MODELE_REPONCTUATION,
        max_tokens: 2000,
        temperature: 0,
        system: SYSTEME_NETTOYAGE,
        messages: [{ role: 'user', content: brut }],
      },
      { timeout: TIMEOUT_REPONCTUATION_MS },
    )
    const sortie = reponse.content[0]?.type === 'text' ? reponse.content[0].text.trim() : ''
    return sortie || brut
  } catch (e) {
    console.error('[transcription] nettoyage:', e)
    return texteBrut ?? ''
  }
}

// Reponctue un texte brut via Claude (consigne stricte, temperature 0), puis
// applique le garde-fou. Renvoie TOUJOURS quelque chose d'exploitable : la version
// reponctuee si elle est sure, sinon le texte brut inchange (fail-open sur erreur,
// timeout ou alteration detectee).
export async function reponctuer(texteBrut: string): Promise<string> {
  const brut = (texteBrut ?? '').trim()
  if (!brut) return texteBrut ?? ''
  try {
    const reponse = await anthropic.messages.create(
      {
        model: MODELE_REPONCTUATION,
        // Marge pour un texte long (dictee de plusieurs minutes) sans tronquer la
        // sortie reponctuee (sinon le garde-fou de fidelite la rejette).
        max_tokens: 4096,
        temperature: 0,
        system: SYSTEME_REPONCTUATION,
        messages: [{ role: 'user', content: brut }],
      },
      { timeout: TIMEOUT_REPONCTUATION_MS },
    )
    const sortie =
      reponse.content[0]?.type === 'text' ? reponse.content[0].text : ''
    return gardeFouFidelite(brut, sortie).texte
  } catch (e) {
    console.error('[transcription] reponctuation:', e)
    return texteBrut ?? ''
  }
}
