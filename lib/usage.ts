// =============================================================
// Journalisation d'usage IA + digests (surveillance & reporting)
// =============================================================
// - logAnthropicUsage : ecrit une ligne dans `usage_logs` apres chaque generation
//   Claude (tokens + cout calcule a l'ecriture). best-effort, ne throw jamais.
// - buildDigest('week'|'month') : agrege l'activite (visites/rapports/photos/
//   vocaux depuis les tables app) + la conso IA (usage_logs) sur la periode,
//   convertit en euros, formate le message FR et l'envoie via notify().
// - tauxUsdVersEur : conversion via frankfurter (repli 0,92).
//
// Tout passe par le client service_role (admin) : RLS bypass, cote serveur uniquement.

import { createAdminClient } from '@/lib/supabase/admin'
import { ATG_USER_ID } from '@/lib/atg'
import { notify, nomDeploiement, echapperHtml } from '@/lib/notify'

type UsageAnthropic = {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

// Tarifs $/M tokens (runbook section 6). Cout calcule AU MOMENT de l'ecriture =>
// historiquement exact meme si les tarifs evoluent ensuite.
const PRICING = {
  sonnet: { in: 3, out: 15 }, // claude-sonnet-4-6 / 4-5
  opus: { in: 5, out: 25 }, //   claude-opus-4-8 / 4-7
  haiku: { in: 1, out: 5 }, //   claude-haiku-4-5
}
const PRICING_DEFAUT = PRICING.sonnet // repli prudent

function tarifPourModele(model: string | null | undefined): { in: number; out: number } {
  const m = (model || '').toLowerCase()
  if (m.includes('opus')) return PRICING.opus
  if (m.includes('haiku')) return PRICING.haiku
  if (m.includes('sonnet')) return PRICING.sonnet
  return PRICING_DEFAUT
}

/** Cout $ d'une generation (entree+sortie). Les tokens de cache ne sont pas factures ici. */
export function coutUsd(model: string | null | undefined, inputTokens: number, outputTokens: number): number {
  const t = tarifPourModele(model)
  return (inputTokens / 1_000_000) * t.in + (outputTokens / 1_000_000) * t.out
}

/** Journalise l'usage d'UNE generation. best-effort : avale ses propres erreurs. */
export async function logAnthropicUsage(params: {
  service: string
  model: string | null
  chantierId?: string | null
  usage: UsageAnthropic | null | undefined
}): Promise<void> {
  try {
    const u = params.usage || {}
    const input = u.input_tokens ?? 0
    const output = u.output_tokens ?? 0
    const cacheRead = u.cache_read_input_tokens ?? 0
    const cacheWrite = u.cache_creation_input_tokens ?? 0
    const admin = createAdminClient()
    await admin.from('usage_logs').insert({
      service: params.service,
      model: params.model,
      chantier_id: params.chantierId ?? null,
      input_tokens: input,
      output_tokens: output,
      cache_read_tokens: cacheRead,
      cache_write_tokens: cacheWrite,
      cost_usd: Number(coutUsd(params.model, input, output).toFixed(6)),
    })
  } catch {
    // La journalisation ne casse JAMAIS une generation.
  }
}

const TAUX_USD_EUR_SECOURS = 0.92

/** USD -> EUR. Appele rarement (une fois par digest). Ne throw jamais. */
export async function tauxUsdVersEur(): Promise<number> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    // NB : api.frankfurter.app redirige desormais (301) vers api.frankfurter.dev/v1.
    const res = await fetch('https://api.frankfurter.dev/v1/latest?from=USD&to=EUR', {
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!res.ok) return TAUX_USD_EUR_SECOURS
    const data = (await res.json()) as { rates?: { EUR?: number } }
    const taux = data?.rates?.EUR
    return typeof taux === 'number' && taux > 0 ? taux : TAUX_USD_EUR_SECOURS
  } catch {
    return TAUX_USD_EUR_SECOURS
  } finally {
    clearTimeout(timer)
  }
}

// ---- Helpers de formatage / fenetre temporelle ----

const fmtNombre = new Intl.NumberFormat('fr-FR')
const fmtJour = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const fmtMois = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })

function fenetre(period: 'week' | 'month'): { debut: Date; fin: Date; titre: string; libelle: string } {
  const now = new Date()
  if (period === 'week') {
    const fin = now
    const debut = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    return {
      debut,
      fin,
      titre: 'Rapport hebdomadaire',
      libelle: `Semaine du ${fmtJour.format(debut)} au ${fmtJour.format(fin)}`,
    }
  }
  // Mois civil PRECEDENT complet (1er -> 1er du mois courant, exclusif).
  const debut = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0))
  const fin = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0))
  return { debut, fin, titre: 'Rapport mensuel', libelle: `Mois de ${fmtMois.format(debut)}` }
}

function pluriel(n: number, singulier: string, plur: string): string {
  return `${fmtNombre.format(n)} ${n > 1 ? plur : singulier}`
}

function formatCoutUsd(c: number): string {
  return `$${c > 0 && c < 0.01 ? c.toFixed(4) : c.toFixed(2)}`
}

function formatCoutEur(c: number): string {
  const n = c > 0 && c < 0.01 ? c.toFixed(4) : c.toFixed(2)
  return `${n.replace('.', ',')} €`
}

export type Digest = {
  period: 'week' | 'month'
  debut: string
  fin: string
  nbVisites: number
  nbRapports: number
  nbDevis: number
  nbPhotos: number
  nbVocaux: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  coutUsd: number
  coutEur: number
  tauxUsdEur: number
  text: string
}

/**
 * Construit ET envoie le digest de la periode. Retourne aussi l'objet (apercu JSON
 * pour le test manuel /api/usage-digest). Lecture seule sur les tables app.
 */
export async function buildDigest(period: 'week' | 'month'): Promise<Digest> {
  const admin = createAdminClient()
  const { debut, fin, titre, libelle } = fenetre(period)
  const debutIso = debut.toISOString()
  const finIso = fin.toISOString()

  const [visites, rapports, devis, photos, vocaux, usage] = await Promise.all([
    admin
      .from('chantiers')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', ATG_USER_ID)
      .gte('created_at', debutIso)
      .lt('created_at', finIso),
    admin
      .from('rapports')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', debutIso)
      .lt('created_at', finIso),
    // Devis « générés » = lignes devis créées sur la période (table devis :
    // colonne de création = `cree_le`, PAS `created_at`). Un devis est créé par
    // l'écran « Proposition technique » (route devis/proposer).
    admin
      .from('devis')
      .select('id', { count: 'exact', head: true })
      .gte('cree_le', debutIso)
      .lt('cree_le', finIso),
    admin
      .from('capture_items')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'photo')
      .gte('created_at', debutIso)
      .lt('created_at', finIso),
    admin
      .from('capture_items')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'vocal')
      .gte('created_at', debutIso)
      .lt('created_at', finIso),
    admin
      .from('usage_logs')
      .select('input_tokens, output_tokens, cost_usd')
      .gte('created_at', debutIso)
      .lt('created_at', finIso),
  ])

  const nbVisites = visites.count ?? 0
  const nbRapports = rapports.count ?? 0
  const nbDevis = devis.count ?? 0
  const nbPhotos = photos.count ?? 0
  const nbVocaux = vocaux.count ?? 0

  const rows = (usage.data ?? []) as Array<{
    input_tokens: number | null
    output_tokens: number | null
    cost_usd: number | string | null
  }>
  const inputTokens = rows.reduce((s, r) => s + (r.input_tokens || 0), 0)
  const outputTokens = rows.reduce((s, r) => s + (r.output_tokens || 0), 0)
  const totalTokens = inputTokens + outputTokens
  const coutUsdTotal = rows.reduce((s, r) => s + Number(r.cost_usd || 0), 0)

  const taux = await tauxUsdVersEur()
  const coutEur = coutUsdTotal * taux

  const text =
    `📊 <b>${echapperHtml(nomDeploiement())}</b>\n` +
    `<b>${titre} — ${echapperHtml(libelle)}</b>\n` +
    `🗓️ <b>Activité</b>\n` +
    `• ${pluriel(nbVisites, 'visite créée', 'visites créées')}\n` +
    `• ${pluriel(nbRapports, 'compte rendu généré', 'comptes rendus générés')}\n` +
    `• ${pluriel(nbDevis, 'devis généré', 'devis générés')}\n` +
    `• ${pluriel(nbPhotos, 'photo', 'photos')}, ${pluriel(nbVocaux, 'vocal', 'vocaux')}\n` +
    `🧠 <b>Consommation IA (Anthropic)</b>\n` +
    `• ${fmtNombre.format(totalTokens)} tokens (entrée ${fmtNombre.format(inputTokens)} / sortie ${fmtNombre.format(outputTokens)})\n` +
    `• Coût : ${formatCoutUsd(coutUsdTotal)}  →  ${formatCoutEur(coutEur)}`

  await notify({ text, kind: 'digest', period })

  return {
    period,
    debut: debutIso,
    fin: finIso,
    nbVisites,
    nbRapports,
    nbDevis,
    nbPhotos,
    nbVocaux,
    inputTokens,
    outputTokens,
    totalTokens,
    coutUsd: coutUsdTotal,
    coutEur,
    tauxUsdEur: taux,
    text,
  }
}
