// =============================================================
// Domaine "comptes rendus de visite" de l'assistant (lecture seule)
// =============================================================
// Meme chaine en trois temps que les devis, mais sur NOTRE base (Supabase) :
//   1. analyserQuestionCr : Claude traduit la question en filtres (JSON).
//   2. code PUR : SELECT des rapports + chantiers, filtres client/periode/theme,
//      puis BORNAGE (voir plus bas). Aucun chiffre/observation invente ici.
//   3. redigerDepuisFaits (redacteur partage) : Claude redige a partir des FAITS.
//
// LECTURE SEULE STRICTE : uniquement des SELECT, jamais d'ecriture. Donnees du
// compte test (projet Supabase ATG), pas le compte reel d'Olivier.
//
// BORNAGE (regle validee) :
//   - question sur UN compte rendu precis (intention detail_chantier, ou un seul
//     CR apres filtrage) -> on envoie le CONTENU COMPLET de ce rapport (un seul
//     rapport est petit) ;
//   - question generale / liste / recherche par theme / plusieurs CR -> on envoie
//     un RESUME BORNE (client + date + objet + titres d'observations + points de
//     vigilance), plafonne, jamais le texte integral de tous les rapports ;
//   - plusieurs CR pour un meme nom -> resume borne + invitation a preciser.

import { anthropic } from '../anthropic'
import { createAdminClient } from '../supabase/admin'
import { redigerDepuisFaits } from './rediger'
import { normaliser, jetonsSignificatifs } from './matching-nom'
import type { RapportContenu } from '../types'

const MODELE_CLAUDE = 'claude-sonnet-4-20250514'
// Plafond du nombre de comptes rendus resumes envoyes au redacteur (bornage de
// volumetrie). Au-dela, on signale la troncature.
const LIMITE_LISTE = 15

// ---------- Types ----------

export interface IntentCr {
  intention: 'liste' | 'detail_chantier' | 'recherche_theme' | 'comptage' | 'inconnu'
  client: string | null
  periode: { debut: string | null; fin: string | null } | null
  motsCles: string[] | null
}

interface CompteRendu {
  chantierId: string
  client: string
  dateISO: string | null // date de visite au format YYYY-MM-DD
  objet: string
  contenu: RapportContenu | null
  pdfUrl: string | null
}

// Normalisation + jetons : voir lib/assistant/matching-nom.ts (helpers partages
// avec le domaine clients pour eviter toute divergence).

// ---------- 1) Lecture seule des comptes rendus (compte test) ----------

// Recupere les comptes rendus (table rapports) joints a leur chantier. SELECT
// uniquement. La volumetrie est faible (quelques rapports) : on lit tout puis on
// filtre en memoire, comme pour les devis.
export async function listerComptesRendus(): Promise<CompteRendu[]> {
  const sb = createAdminClient()
  const { data, error } = await sb
    .from('rapports')
    .select('chantier_id, contenu_json, pdf_url, chantiers(client_nom, date_visite, objet_travaux)')
  if (error) throw new Error(`Supabase /rapports : ${error.message}`)

  return (data ?? []).map((r: any) => {
    // Le join "to-one" peut remonter un objet ou un tableau selon le client.
    const ch = Array.isArray(r.chantiers) ? r.chantiers[0] ?? {} : r.chantiers ?? {}
    const contenu = (r.contenu_json ?? null) as RapportContenu | null
    return {
      chantierId: r.chantier_id,
      client: ch.client_nom ?? contenu?.client?.nom ?? '(client non renseigné)',
      dateISO: (ch.date_visite ?? '').slice(0, 10) || null,
      objet: ch.objet_travaux ?? '',
      contenu,
      pdfUrl: r.pdf_url ?? null,
    }
  })
}

// ---------- 2a) Analyse de la question (Claude -> intent JSON) ----------

function promptAnalyseCr(question: string, aujourdhui: string): string {
  return `Tu analyses une question d'Olivier (artisan façades) sur SES comptes rendus de visite de chantier. Tu ne reponds PAS : tu la traduis en filtres structures.

DATE DU JOUR : ${aujourdhui} (pour interpreter "ce mois-ci", "en mai", "le dernier"...).

QUESTION :
---
${question}
---

Reponds STRICTEMENT en JSON valide (aucun texte autour, pas de markdown), schema EXACT :
{
  "intention": "liste | detail_chantier | recherche_theme | comptage | inconnu",
  "client": "<nom de client ou de chantier recherche, ou null>",
  "periode": { "debut": "YYYY-MM-DD ou null", "fin": "YYYY-MM-DD ou null" },
  "motsCles": ["<termes techniques recherches, ex: fissure, humidite, mousse>"]
}

REGLES :
- "intention" : "detail_chantier" si la question vise un compte rendu/chantier precis (un client nomme, "le compte rendu de...") ; "recherche_theme" si elle cherche les chantiers presentant un sujet (fissures, humidite, mousse, decollement...) ; "liste" pour lister sans theme precis ; "comptage" pour un nombre de comptes rendus/visites ; "inconnu" si hors sujet.
- "client" : uniquement si un client ou un chantier precis est nomme, sinon null.
- "periode" : convertis les expressions relatives en dates absolues a partir de la DATE DU JOUR. Si aucune periode, debut et fin a null.
- "motsCles" : la liste des themes/termes recherches pour "recherche_theme", sinon null. Mets les mots au singulier et sans accent si possible.
- N'invente aucun filtre non demande.`
}

function extraireJson(texte: string): any {
  const m = texte.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('Aucun JSON dans la reponse d\'analyse CR.')
  return JSON.parse(m[0])
}

export async function analyserQuestionCr(
  question: string,
  aujourdhui: string,
): Promise<IntentCr> {
  const rep = await anthropic.messages.create({
    model: MODELE_CLAUDE,
    max_tokens: 400,
    temperature: 0,
    messages: [{ role: 'user', content: promptAnalyseCr(question, aujourdhui) }],
  })
  const texte = rep.content[0]?.type === 'text' ? rep.content[0].text : ''
  const p = extraireJson(texte)
  const motsCles = Array.isArray(p.motsCles)
    ? p.motsCles.map((m: unknown) => String(m)).filter(Boolean)
    : null
  return {
    intention: p.intention ?? 'inconnu',
    client: p.client ?? null,
    periode:
      p.periode && (p.periode.debut || p.periode.fin)
        ? { debut: p.periode.debut ?? null, fin: p.periode.fin ?? null }
        : null,
    motsCles: motsCles && motsCles.length ? motsCles : null,
  }
}

// ---------- 2b) Filtres en code (pur, sur les vraies donnees) ----------

// Matching par jetons : TOUS les jetons significatifs de la recherche doivent
// etre presents dans le nom du chantier (ex : "Dupont" -> "M. et Mme Dupont" ;
// "Charles Daquin" -> "Résidence Charles Daquin"). Repli sur l'inclusion brute si
// la recherche ne contient aucun jeton significatif (que des civilites).
function correspondClient(cr: CompteRendu, client: string): boolean {
  const b = normaliser(client)
  if (!b) return true
  const cible = normaliser(cr.client)
  const jetons = jetonsSignificatifs(client)
  if (jetons.length === 0) return cible.includes(b) || b.includes(cible)
  return jetons.every((t) => cible.includes(t))
}

// ---------- Matching SOUPLE (bug 2 vague 2 : repli si l'exact ne trouve rien) ----------
// Utilise UNIQUEMENT en secours, et signale au redacteur que la correspondance
// est approchante (le redacteur invite alors a confirmer le bon chantier). On
// peut se permettre cette souplesse car on est en LECTURE SEULE : au pire on
// montre un CR qu'Olivier reconnait comme pas le bon.

// Distance d'edition (Levenshtein) classique, en programmation dynamique.
function distanceEdition(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let ligne = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diagonale = ligne[0]
    ligne[0] = i
    for (let j = 1; j <= b.length; j++) {
      const provisoire = ligne[j]
      const cout = a[i - 1] === b[j - 1] ? 0 : 1
      ligne[j] = Math.min(ligne[j] + 1, ligne[j - 1] + 1, diagonale + cout)
      diagonale = provisoire
    }
  }
  return ligne[b.length]
}

// Ecart de lettres tolere selon la longueur du plus long jeton : rien sur les
// jetons courts (2-3, ou 1 faute change l'identite), 1 sur 4-6, 2 sur 7+.
function toleranceJeton(t: string, u: string): number {
  const maxLen = Math.max(t.length, u.length)
  if (maxLen <= 3) return 0
  if (maxLen <= 6) return 1
  return 2
}

// Deux jetons concordent souplement si : egaux, OU l'un est sous-chaine de
// l'autre, OU leur distance d'edition tient dans la tolerance liee a la longueur.
function concordeJeton(t: string, u: string): boolean {
  if (t === u) return true
  if (u.includes(t) || t.includes(u)) return true
  return distanceEdition(t, u) <= toleranceJeton(t, u)
}

// Nombre minimal de jetons concordants exige : TOUS si N <= 2 (sinon on
// rapprocherait tout "Saint X" / "Résidence Y"), sinon la majorite ceil(2N/3).
function seuilMajorite(n: number): number {
  if (n <= 2) return n
  return Math.ceil((n * 2) / 3)
}

// Correspondance souple : on tokenise les DEUX cotes ; un jeton de la recherche
// "matche" s'il concorde souplement avec au moins un jeton du nom stocke ; on
// exige le seuil de majorite. Jamais appele si la passe exacte a deja trouve.
function correspondClientSouple(cr: CompteRendu, client: string): boolean {
  const jetons = jetonsSignificatifs(client)
  if (jetons.length === 0) return false
  const jetonsCible = jetonsSignificatifs(cr.client)
  if (jetonsCible.length === 0) return false
  const concordants = jetons.filter((t) => jetonsCible.some((u) => concordeJeton(t, u))).length
  return concordants >= seuilMajorite(jetons.length)
}

function dansPeriode(
  cr: CompteRendu,
  periode: { debut: string | null; fin: string | null },
): boolean {
  if (!cr.dateISO) return false
  const { debut, fin } = periode
  return (!debut || cr.dateISO >= debut) && (!fin || cr.dateISO <= fin)
}

// Texte normalise d'un compte rendu (objet + observations + points de vigilance +
// acces + notes), pour la recherche par theme.
function texteRecherche(cr: CompteRendu): string {
  const c = cr.contenu
  const morceaux: string[] = [cr.objet]
  if (c) {
    for (const o of c.observations ?? []) {
      morceaux.push(o.titre, o.description, ...(o.points_vigilance ?? []))
    }
    morceaux.push(c.acces_chantier ?? '', c.notes ?? '')
  }
  return normaliser(morceaux.join(' '))
}

// Correspond si AU MOINS un mot-cle recherche est present (recherche inclusive).
function correspondMotsCles(cr: CompteRendu, motsCles: string[]): boolean {
  const texte = texteRecherche(cr)
  return motsCles.some((m) => {
    const n = normaliser(m)
    return n.length > 0 && texte.includes(n)
  })
}

// ---------- 2c) Bornage : resume vs contenu complet ----------

// Resume BORNE d'un compte rendu (pas le texte integral) : titres d'observations
// et points de vigilance, pour les questions generales/listes/themes.
function resumeBorne(cr: CompteRendu) {
  const obs = cr.contenu?.observations ?? []
  return {
    client: cr.client,
    date_visite: cr.dateISO,
    objet: cr.objet || null,
    nombre_observations: obs.length,
    titres_observations: obs.map((o) => o.titre),
    points_vigilance: obs.flatMap((o) => o.points_vigilance ?? []),
  }
}

// Contenu COMPLET d'un compte rendu (un seul rapport, petit) : observations
// detaillees, acces, duree, notes. On ne pousse pas les URL de photos (bruit),
// seulement leurs legendes qui portent du sens.
function contenuComplet(cr: CompteRendu) {
  const c = cr.contenu
  return {
    client: cr.client,
    date_visite: cr.dateISO,
    objet: cr.objet || null,
    observations: (c?.observations ?? []).map((o) => ({
      titre: o.titre,
      description: o.description,
      points_vigilance: o.points_vigilance ?? [],
      legendes_photos: (o.photos ?? []).map((p) => p.legende).filter(Boolean),
    })),
    acces_chantier: c?.acces_chantier ?? null,
    duree_estimee: c?.duree_estimee ?? null,
    notes: c?.notes ?? null,
  }
}

// ---------- 3) Orchestration du domaine ----------

export interface ReponseCr {
  reponse: string
  nbComptesRendus: number
}

// Repond a une question sur les comptes rendus (lecture seule). `crPreCharges`
// evite de relire la base a chaque appel dans les tests.
export async function repondreQuestionCr(
  question: string,
  aujourdhui: string,
  crPreCharges?: CompteRendu[],
): Promise<ReponseCr> {
  const tous = crPreCharges ?? (await listerComptesRendus())
  const intent = await analyserQuestionCr(question, aujourdhui)

  // Filtres en code (pur). Le client se filtre en DEUX passes (bug 2) : exacte
  // d'abord, puis souple en secours SEULEMENT si l'exacte ne trouve rien. Une
  // correspondance trouvee en souple est signalee comme approchante.
  let base = tous
  let correspondanceApprochante = false
  if (intent.client) {
    const exact = base.filter((cr) => correspondClient(cr, intent.client!))
    if (exact.length > 0) {
      base = exact
    } else {
      const souple = base.filter((cr) => correspondClientSouple(cr, intent.client!))
      base = souple
      correspondanceApprochante = souple.length > 0
    }
  }
  if (intent.periode) base = base.filter((cr) => dansPeriode(cr, intent.periode!))
  if (intent.motsCles) base = base.filter((cr) => correspondMotsCles(cr, intent.motsCles!))

  // Tri par date de visite decroissante (le plus recent d'abord).
  base = [...base].sort((a, b) => (b.dateISO ?? '').localeCompare(a.dateISO ?? ''))

  const filtres = {
    client: intent.client,
    periode: intent.periode,
    mots_cles: intent.motsCles,
  }

  // Comptage : le code compte, l'assistant restitue le nombre.
  if (intent.intention === 'comptage') {
    const faits = {
      mode: 'comptage',
      nombre_de_comptes_rendus: base.length,
      filtres,
      correspondance_approchante: correspondanceApprochante,
    }
    const reponse = await redigerDepuisFaits({
      question,
      sujet: 'comptes rendus de visite',
      faits,
    })
    return { reponse, nbComptesRendus: base.length }
  }

  // Bascule du bornage.
  let faits: unknown
  if (base.length === 1) {
    // Un seul compte rendu : contenu complet (petit, aucun risque de volumetrie).
    faits = {
      mode: 'compte_rendu_detaille',
      filtres,
      correspondance_approchante: correspondanceApprochante,
      compte_rendu: contenuComplet(base[0]),
    }
  } else {
    // Plusieurs (ou zero) : resume borne. Si l'intention visait un CR precis mais
    // que plusieurs correspondent (homonymes), on invite a preciser.
    const ambiguite = intent.intention === 'detail_chantier' && base.length > 1
    faits = {
      mode: ambiguite ? 'plusieurs_correspondances' : 'resume',
      nombre_de_comptes_rendus: base.length,
      filtres,
      correspondance_approchante: correspondanceApprochante,
      invitation_a_preciser: ambiguite,
      comptes_rendus: base.slice(0, LIMITE_LISTE).map(resumeBorne),
      comptes_rendus_tronques: Math.max(0, base.length - LIMITE_LISTE),
    }
  }

  const reponse = await redigerDepuisFaits({
    question,
    sujet: 'comptes rendus de visite',
    faits,
  })
  return { reponse, nbComptesRendus: base.length }
}
