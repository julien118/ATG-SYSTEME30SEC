import Anthropic from '@anthropic-ai/sdk'

// Modele Claude unique pour TOUTE la couche IA de l'app (generation de rapport,
// assistant, proposition de devis, transcription/reponctuation, parsing metres...).
// Centralise ICI pour qu'une retraite de modele par Anthropic soit un changement a
// UN SEUL endroit : le 15 juin 2026, claude-sonnet-4-20250514 a ete retire et a
// casse toute la couche IA d'un coup.
//
// Surcharge possible via ANTHROPIC_MODEL (sans redeploiement). Defaut identique a
// aujourd'hui. Chaine exacte, sans suffixe de date.
export const MODELE_CLAUDE = process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-6'

// Chaine de repli : si le modele prefere est RETIRE par Anthropic, la generation
// bascule AUTOMATIQUEMENT sur le suivant, pour que personne ne soit jamais coupe
// (c'est precisement le scenario du 15 juin). Dedupliquee pour ne pas tester deux
// fois le meme id.
export const MODEL_CHAIN: string[] = Array.from(
  new Set([MODELE_CLAUDE, 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-opus-4-8']),
)

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Methode `create` ORIGINALE, capturee AVANT remplacement (sert au canari sante et
// au wrapper). Le cast restaure la signature surchargee (streaming/non-streaming).
type CreateFn = typeof client.messages.create
type Corps = Parameters<CreateFn>[0]
type Options = Parameters<CreateFn>[1]
const createBrut = client.messages.create.bind(client.messages) as CreateFn

/**
 * Vrai si l'erreur signifie « ce modele est retire / introuvable » => on passe au
 * suivant de la chaine. ATTENTION : un retrait de modele remonte souvent en HTTP 400
 * (invalid_request_error dont le message reference le modele) et pas seulement en 404
 * — c'est exactement ce qui s'est passe le 15 juin. Les 429 / 5xx / overloaded /
 * connexion ne sont PAS un retrait : on ne brule pas la chaine, on rethrow.
 */
function estModeleIntrouvable(err: unknown, model: string): boolean {
  if (!(err instanceof Anthropic.APIError)) return false
  if (err.status === 404) return true
  if (err.status === 400) {
    const msg = (err.message || '').toLowerCase()
    return msg.includes('model') && (msg.includes(model.toLowerCase()) || msg.includes('not found') || msg.includes('not_found'))
  }
  return false
}

/** Appel non-streaming avec repli de modele + journalisation d'usage best-effort. */
async function createAvecRepli(body: Corps, options?: Options): Promise<Anthropic.Message> {
  const chaine = Array.from(new Set([(body as { model: string }).model, ...MODEL_CHAIN]))
  let derniereErreur: unknown
  for (const model of chaine) {
    try {
      const reponse = (await createBrut({ ...body, model }, options)) as Anthropic.Message
      // Journalisation fire-and-forget. Import DYNAMIQUE pour eviter tout cycle
      // d'import (lib/usage -> supabase/admin). Avale ses propres erreurs.
      import('@/lib/usage')
        .then((m) => m.logAnthropicUsage({ service: 'claude', model, usage: reponse.usage }))
        .catch(() => {})
      return reponse
    } catch (err) {
      derniereErreur = err
      if (estModeleIntrouvable(err, model)) continue // modele retire : on tente le suivant
      throw err // transitoire : on remonte tout de suite
    }
  }
  throw derniereErreur
}

// Remplace messages.create par le wrapper (repli + log). Les ~13 sites d'appel
// importent toujours `anthropic` et `MODELE_CLAUDE` : ZERO changement chez eux, ils
// se contentent d'`await` + `.content[0].text`. Le cast est obligatoire (methode
// surchargee) et sur dans ce contexte (aucun site n'exploite l'APIPromise).
;(client.messages as { create: CreateFn }).create = function patchedCreate(
  body: Corps,
  options?: Options,
) {
  if ((body as { stream?: boolean }).stream) {
    return createBrut(body, options) // streaming : passe-plat (jamais utilise dans ATG)
  }
  return createAvecRepli(body, options)
} as CreateFn

export const anthropic = client

/**
 * Canari sante : teste UN modele precis (pas de repli, pas de log), max_tokens:1.
 * Retourne false si le modele est injoignable/retire. Ne throw jamais.
 */
export async function probeModele(model: string = MODELE_CLAUDE): Promise<boolean> {
  try {
    await createBrut({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
    return true
  } catch {
    return false
  }
}
