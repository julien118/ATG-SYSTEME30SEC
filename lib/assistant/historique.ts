// =============================================================
// Historique de conversation de l'assistant (compréhension seulement)
// =============================================================
// Mémoire de la conversation EN COURS, transmise par le frontend à chaque appel
// (serveur stateless, comme « dernierClient »). Sert UNIQUEMENT a la COMPREHENSION
// (aiguillage + analyse des domaines) pour resoudre une question qui s'appuie sur
// le passe (« le compte rendu dont on parlait », « et le devis ? »). Il n'alimente
// JAMAIS la redaction : les reponses restent FAITS-only (vraies donnees).
//
// Anti-hallucination : une reference se resout vers un NOM qui est ensuite re-valide
// contre les vraies donnees par le code du domaine (matching exact/souple). Si la
// reference est ambigue ou introuvable, on laisse le champ a null et le code demande
// de preciser, jamais de devinette.

// Un message d'historique transmis par le frontend (questions d'Olivier + reponses
// de l'assistant). Forme volontairement minimale.
export interface MessageHistorique {
  role: 'user' | 'bot'
  texte: string
}

// Bornage : on ne transmet jamais toute la conversation au LLM. On garde les
// derniers echanges et on tronque les reponses bot (recaps/listes longs) pour ne
// pas exploser les tokens ni la latence.
const MAX_MESSAGES = 8
const MAX_BOT = 400
const MAX_USER = 300

function tronquer(s: string, max: number): string {
  const t = (s ?? '').trim()
  return t.length > max ? `${t.slice(0, max).trimEnd()}...` : t
}

// Nettoie + borne un historique brut venu du frontend (filtre les entrees mal
// formees). Renvoie un tableau sur, eventuellement vide.
export function nettoyerHistorique(brut?: unknown): MessageHistorique[] {
  if (!Array.isArray(brut)) return []
  return brut
    .filter(
      (m): m is MessageHistorique =>
        !!m &&
        ((m as MessageHistorique).role === 'user' || (m as MessageHistorique).role === 'bot') &&
        typeof (m as MessageHistorique).texte === 'string' &&
        (m as MessageHistorique).texte.trim().length > 0,
    )
    .map((m) => ({ role: m.role, texte: m.texte }))
}

// Construit un transcript compact des derniers echanges (du plus ancien au plus
// recent), borne et tronque. Retourne '' si pas d'historique exploitable.
export function formaterHistorique(historique?: MessageHistorique[] | null): string {
  if (!Array.isArray(historique) || historique.length === 0) return ''
  return historique
    .slice(-MAX_MESSAGES)
    .filter((m) => m && typeof m.texte === 'string' && m.texte.trim())
    .map((m) =>
      m.role === 'user'
        ? `Olivier : ${tronquer(m.texte, MAX_USER)}`
        : `Assistant : ${tronquer(m.texte, MAX_BOT)}`,
    )
    .join('\n')
}

// Bloc a inserer dans un prompt d'ANALYSE de domaine quand un historique est fourni :
// le transcript + les regles d'usage (priorite au nom explicite, anti-hallucination).
// Vide si pas d'historique (=> comportement strictement inchange).
export function blocHistoriquePourAnalyse(historique?: MessageHistorique[] | null): string {
  const transcript = formaterHistorique(historique)
  if (!transcript) return ''
  return `
HISTORIQUE DE LA CONVERSATION EN COURS (du plus ancien au plus recent) :
---
${transcript}
---
REGLES D'USAGE DE L'HISTORIQUE :
- Si la question nomme explicitement un client ou un chantier, utilise CE nom : ignore l'historique pour l'identite.
- N'utilise l'historique QUE pour resoudre une reference qui n'est pas resoluble depuis la seule question (ex : « le compte rendu dont on parlait », « et le devis ? », « celui d'avant »).
- Ne JAMAIS inventer un nom ou une entite absent de la conversation. Si la reference est ambigue (plusieurs candidats possibles) ou introuvable, NE DEVINE PAS : laisse le champ concerne a null (le code demandera de preciser).
`
}

// Bloc plus leger pour l'AIGUILLEUR (classification du sujet uniquement) : le
// transcript pour router une question qui s'appuie sur le passe. Vide si pas
// d'historique.
export function blocHistoriquePourAiguillage(historique?: MessageHistorique[] | null): string {
  const transcript = formaterHistorique(historique)
  if (!transcript) return ''
  return `
HISTORIQUE DE LA CONVERSATION (pour comprendre une question qui s'appuie sur le passe, ex : « compare avec le premier », « le compte rendu dont on parlait ») :
---
${transcript}
---
Tu classes seulement le SUJET, tu n'inventes aucun client. Une question qui fait reference a un element deja evoque releve du domaine de cet element.
`
}
