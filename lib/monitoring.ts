// =============================================================
// Surveillance d'erreurs (alerte raison + solution)
// =============================================================
// reportError(context, error) envoie une alerte Telegram avec OU s'est produite
// l'erreur, la RAISON, et COMMENT la resoudre (heuristique diagnose()), pour que
// l'admin la voie AVANT l'utilisateur (qui, lui, voit un ecran propre « Reessayer »).
//
// REGLE D'OR : best-effort, ne throw JAMAIS, ne bloque jamais l'appelant.
// Anti-spam : une meme signature (context|message) n'alerte qu'1x / 5 min.

import { notify, nomDeploiement, echapperHtml } from '@/lib/notify'

type Diagnostic = { raison: string; solution: string }

/** Traduit (context, error) en (raison lisible, solution actionnable) en francais. */
export function diagnose(context: string, error: unknown): Diagnostic {
  const err = error as { status?: number; message?: string } | null
  const status = typeof err?.status === 'number' ? err.status : undefined
  const message = (err?.message || String(error ?? '') || '').trim()
  const bas = message.toLowerCase()
  const ctx = context.toLowerCase()

  // --- Anthropic / modele ---
  if (status === 429 || bas.includes('rate_limit') || bas.includes('rate limit')) {
    return {
      raison: message || 'Limite de débit Anthropic (429)',
      solution: 'Limite de débit Anthropic atteinte — temporaire, réessayer dans quelques minutes.',
    }
  }
  if (
    (status === 404 && bas.includes('model')) ||
    (status === 400 && bas.includes('model') && (bas.includes('not found') || bas.includes('not_found'))) ||
    (bas.includes('not_found_error') && bas.includes('model'))
  ) {
    return {
      raison: message || 'Modèle Anthropic introuvable',
      solution:
        'Modèle Anthropic retiré/introuvable — la génération bascule en repli automatiquement (personne n\'est bloqué) ; mettre à jour ANTHROPIC_MODEL.',
    }
  }
  if (
    status === 401 ||
    bas.includes('authentication') ||
    bas.includes('invalid api key') ||
    bas.includes('x-api-key') ||
    bas.includes('unauthorized')
  ) {
    return {
      raison: message || 'Authentification refusée (401)',
      solution: 'Clé API invalide/expirée — vérifier ANTHROPIC_API_KEY / GROQ_API_KEY / COSTRUCTOR_API_KEY dans Vercel.',
    }
  }

  // --- Transcription (Groq / Whisper) ---
  if (bas.includes('groq') || bas.includes('whisper') || ctx.includes('transcription') || ctx.includes('vocal')) {
    return {
      raison: message || 'Échec de transcription',
      solution: 'Souci de transcription vocale (Groq/Whisper) — vérifier GROQ_API_KEY et le format/taille de l\'audio.',
    }
  }

  // --- Costructor (push devis / contact) ---
  if (bas.includes('costructor') || ctx.includes('costructor') || ctx.includes('devis') || ctx.includes('contact')) {
    return {
      raison: message || 'Erreur côté Costructor',
      solution: 'Erreur Costructor (API devis/contact) — vérifier COSTRUCTOR_API_KEY et la disponibilité de leur API.',
    }
  }

  // --- Supabase / Storage ---
  if (bas.includes('supabase') || bas.includes('storage') || bas.includes('row-level') || bas.includes('jwt')) {
    return {
      raison: message || 'Erreur base / Storage',
      solution: 'Erreur Supabase (base/Storage) — vérifier les clés SUPABASE et l\'état du projet (pause d\'inactivité ?).',
    }
  }

  // --- PDF ---
  if (bas.includes('pdf') || ctx.includes('pdf')) {
    return {
      raison: message || 'Échec PDF',
      solution: 'Échec de génération/lecture du PDF — vérifier le contenu du rapport et le bucket Storage « rapports ».',
    }
  }

  return {
    raison: message || 'Erreur inconnue',
    solution: 'Erreur inattendue — consulter les Runtime Logs Vercel pour la stack complète.',
  }
}

// Anti-spam : meme signature => 1 alerte / 5 min (Map en memoire process).
const FENETRE_ANTISPAM_MS = 5 * 60 * 1000
const dernieresAlertes = new Map<string, number>()

const fmtHorodatage = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
})

/**
 * Alerte l'admin (Telegram + webhook) avec ou/raison/solution. Anti-spam integre.
 * best-effort : si la notif echoue, on n'en fait pas un drame (catch silencieux).
 */
export async function reportError(context: string, error: unknown): Promise<void> {
  try {
    const message = ((error as { message?: string })?.message || String(error ?? '') || '').trim()
    const signature = `${context}|${message}`.slice(0, 300)
    const maintenant = Date.now()
    const precedent = dernieresAlertes.get(signature)
    if (precedent && maintenant - precedent < FENETRE_ANTISPAM_MS) return
    dernieresAlertes.set(signature, maintenant)

    // Purge legere pour borner la Map sur une instance longue duree.
    if (dernieresAlertes.size > 500) {
      dernieresAlertes.forEach((ts, cle) => {
        if (maintenant - ts > FENETRE_ANTISPAM_MS) dernieresAlertes.delete(cle)
      })
    }

    const { raison, solution } = diagnose(context, error)
    const text =
      `🚨 <b>${echapperHtml(nomDeploiement())}</b> — erreur détectée\n` +
      `📍 <b>Où</b> : ${echapperHtml(context)}\n` +
      `💬 <b>Raison</b> : ${echapperHtml(raison)}\n` +
      `🔧 <b>Solution</b> : ${echapperHtml(solution)}\n` +
      `🕐 ${fmtHorodatage.format(new Date(maintenant))}`

    await notify({ text, kind: 'error', context })
  } catch {
    // La surveillance ne casse JAMAIS l'appelant.
  }
}
