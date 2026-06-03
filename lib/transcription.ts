// =============================================================
// Transcription vocale (lot 2.1) — moteur Whisper avec prompt metier
// =============================================================
// `transcrireAudio` : appel Groq Whisper turbo partage par /api/transcribe (notes
// de visite) et /api/devis/metres-vocaux (metres dictes), avec un PROMPT METIER
// (biaise l'orthographe du vocabulaire batiment d'Olivier et la ponctuation) et
// `temperature: 0` (sortie litterale, pas de paraphrase). Risque de fidelite nul :
// le prompt ne fait qu'orienter, c'est l'audio qui dicte le contenu.

import Groq from 'groq-sdk'

const MODELE_WHISPER = 'whisper-large-v3-turbo'
const TIMEOUT_WHISPER_MS = 20000

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
