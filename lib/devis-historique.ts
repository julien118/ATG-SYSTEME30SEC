// =============================================================
// Moteur de consultation de l'historique des devis (lecture seule)
// =============================================================
// Assistant de CONSULTATION PURE : il lit les devis du compte test (la réplique
// chez Julien) et répond en français a une question en langage naturel. Il ne
// cree et ne modifie JAMAIS rien (GET uniquement).
//
// Anti-hallucination (regle absolue) : le LLM ne calcule AUCUN chiffre. Le flux
// est en trois temps :
//   1. analyserQuestion  : Claude traduit la question en filtres + agregat (JSON).
//   2. executerRequete   : code PUR qui filtre les vrais devis et calcule les
//      montants/moyennes/comptes a partir des donnees reelles (en centimes).
//   3. redigerReponse    : Claude redige la reponse a partir des FAITS calcules
//      (montants deja convertis en euros), sans jamais inventer de chiffre.
//
// Bascule production : on ne branchera sur les vrais devis d'Olivier qu'a la
// prod. Ici, lecture seule stricte sur le compte test (COSTRUCTOR_API_KEY).

import { anthropic } from './anthropic'
import { correspondNomSouple, faitReferenceClientPrecedent } from './assistant/matching-nom'
import { blocHistoriquePourAnalyse, type MessageHistorique } from './assistant/historique'

const BASE_URL =
  process.env.COSTRUCTOR_API_BASE_URL || 'https://api.costructor.co/external/v1'
const MODELE_CLAUDE = 'claude-sonnet-4-20250514'

// ---------- Types ----------

export interface TypologieDevis {
  famille: 'ravalement' | 'ite' | null
  variante: string | null // ex: 'ravalement_i3_peinture', 'ite_detaille'
}

export interface DevisResume {
  id: string
  numero: string | null
  clientNom: string
  dateISO: string | null // issuedAt (ou createdAt) au format YYYY-MM-DD
  montantHTCentimes: number // subtotal (HT) en centimes
  statut: string
  description: string
  typologie: TypologieDevis
}

export interface IntentRequete {
  intention:
    | 'liste_client'
    | 'agregat'
    | 'top_montant'
    | 'comptage'
    | 'comparaison'
    | 'liste_generale'
    | 'inconnu'
  client: string | null
  typologie: string | null // famille ('ravalement'|'ite') ou clé de variante
  periode: { debut: string | null; fin: string | null } | null
  agregat: 'somme' | 'moyenne' | 'max' | 'min' | 'compte' | null
  limite: number | null
}

export interface ResultatRequete {
  intention: string
  filtres: { client: string | null; typologie: string | null; periode: { debut: string | null; fin: string | null } | null }
  nbDevis: number
  devis: DevisResume[] // devis correspondants (tries selon l'intention)
  agregat: { type: string; valeurCentimes: number | null; valeurNombre: number | null } | null
  // true quand le client a ete retrouve en matching SOUPLE (faute de frappe) et
  // pas en exact : le redacteur invite alors a confirmer le bon client.
  correspondanceApprochante: boolean
}

// ---------- Normalisation + détection de typologie ----------

function normaliser(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Détecte la typologie d'un devis a partir de sa description (heuristique, suffit
// pour filtrer). En cas de mention mixte, l'ITE prime si elle est explicite.
export function detecterTypologie(texte: string | null | undefined): TypologieDevis {
  const d = normaliser(texte)
  const estIte = /\bite\b|isolation thermique|isolation par l.?ext|isolant|polystyr|\bpse\b|starsystem/.test(d)
  const estRav = /ravalement|\bi3\b|\bi4\b|peinture|taloch|enduit|imperm/.test(d)

  let famille: TypologieDevis['famille'] = null
  if (estIte && !estRav) famille = 'ite'
  else if (estRav && !estIte) famille = 'ravalement'
  else if (estIte && estRav) famille = /isolation thermique|\bite\b/.test(d) ? 'ite' : 'ravalement'

  let variante: string | null = null
  if (famille === 'ite') {
    variante = /garantie decennale|volet|report|partie (non )?chauffee/.test(d) ? 'ite_detaille' : 'ite_standard'
  } else if (famille === 'ravalement') {
    if (/\bi4\b/.test(d)) variante = 'ravalement_i4_taloche'
    else if (/i3\s*taloch|taloch/.test(d)) variante = 'ravalement_i3_taloche'
    else if (/\bi3\b|peinture/.test(d)) variante = 'ravalement_i3_peinture'
  }
  return { famille, variante }
}

// ---------- Lecture seule des devis (compte test) ----------

// Recupere les devis exploitables du compte test (model:false, non supprimes).
// GET uniquement. Aucune ecriture.
export async function listerDevisCompteTest(): Promise<DevisResume[]> {
  const key = process.env.COSTRUCTOR_API_KEY
  if (!key) throw new Error('COSTRUCTOR_API_KEY manquante dans .env.local')
  const r = await fetch(`${BASE_URL}/quotes?_limit=1000`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`Costructor ${r.status} sur /quotes : ${await r.text()}`)
  const j = (await r.json()) as { data?: any[] } & any
  const tous = (j.data ?? j) as any[]
  return tous
    .filter((q) => !q.model && !q.deletedAt && q.status !== 'deleted')
    .map((q) => {
      const cust = q.customer
      const clientNom =
        typeof cust === 'object' && cust
          ? (cust.fullName ?? `${cust.firstName ?? ''} ${cust.lastName ?? ''}`.trim())
          : ''
      const dateISO = (q.issuedAt ?? q.createdAt ?? '').slice(0, 10) || null
      const description = (q.description ?? q.name ?? '')
      return {
        id: q.id,
        numero: q.number ?? null,
        clientNom: clientNom || '(client non renseigné)',
        dateISO,
        montantHTCentimes: q.subtotal ?? 0,
        statut: q.status ?? 'draft',
        description,
        typologie: detecterTypologie(description),
      } as DevisResume
    })
}

// ---------- 1) Analyse de la question (Claude -> intent JSON) ----------

function promptAnalyse(
  question: string,
  aujourdhui: string,
  historique?: MessageHistorique[] | null,
): string {
  return `Tu analyses une question posee par un artisan (Olivier, façades : ravalement et ITE) sur l'historique de SES devis. Tu ne reponds PAS a la question : tu la traduis en filtres structures pour une recherche en base.

DATE DU JOUR : ${aujourdhui} (pour interpreter "ce mois-ci", "cette annee", "en mai", "le mois dernier"...).

QUESTION :
---
${question}
---
${blocHistoriquePourAnalyse(historique)}
Reponds STRICTEMENT en JSON valide (aucun texte autour, pas de markdown), schema EXACT :
{
  "intention": "liste_client | agregat | top_montant | comptage | comparaison | liste_generale | inconnu",
  "client": "<nom de client recherche, ou null>",
  "typologie": "<ravalement | ite | ravalement_i3_peinture | ravalement_i3_taloche | ravalement_i4_taloche | ite_detaille | ite_standard | null>",
  "periode": { "debut": "YYYY-MM-DD ou null", "fin": "YYYY-MM-DD ou null" },
  "agregat": "somme | moyenne | max | min | compte | null",
  "limite": <nombre pour un top N, ou null>
}

REGLES :
- "intention" : choisis la plus proche. "liste_client" = lister les devis d'un client ; "agregat" = un total/moyenne/min/max ; "top_montant" = les plus gros devis ; "comptage" = combien de devis ; "comparaison" = comparer des prix de devis similaires ; "liste_generale" = lister sans filtre client precis ; "inconnu" si hors sujet.
- "client" : uniquement si un client precis est nomme, sinon null.
- "typologie" : "ravalement" ou "ite" pour la famille ; une cle precise si la variante est claire (I3 peinture, I4, ITE detaillee...). Sinon null.
- "periode" : convertis les expressions relatives en dates absolues a partir de la DATE DU JOUR. "en mai" => mois de mai de l'annee courante. Si aucune periode, mets debut et fin a null.
- "agregat" : "somme" pour un total/chiffre d'affaires, "moyenne" pour un prix moyen, "max"/"min" pour le plus gros/petit, "compte" pour un nombre. null si pas d'agregat.
- "limite" : pour "mes 3 plus gros devis" => 3. Sinon null.
- N'invente aucun filtre non demande.`
}

function extraireJson(texte: string): any {
  const m = texte.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('Aucun JSON dans la reponse d\'analyse.')
  return JSON.parse(m[0])
}

export async function analyserQuestion(
  question: string,
  aujourdhui: string,
  historique?: MessageHistorique[] | null,
): Promise<IntentRequete> {
  const rep = await anthropic.messages.create({
    model: MODELE_CLAUDE,
    max_tokens: 600,
    messages: [{ role: 'user', content: promptAnalyse(question, aujourdhui, historique) }],
  })
  const texte = rep.content[0]?.type === 'text' ? rep.content[0].text : ''
  const p = extraireJson(texte)
  return {
    intention: p.intention ?? 'inconnu',
    client: p.client ?? null,
    typologie: p.typologie ?? null,
    periode: p.periode && (p.periode.debut || p.periode.fin) ? { debut: p.periode.debut ?? null, fin: p.periode.fin ?? null } : null,
    agregat: p.agregat ?? null,
    limite: typeof p.limite === 'number' ? p.limite : null,
  }
}

// ---------- 2) Exécution de la requête (code PUR, chiffres reels) ----------

const FAMILLES = new Set(['ravalement', 'ite'])

function correspondTypologie(d: DevisResume, typ: string): boolean {
  if (FAMILLES.has(typ)) return d.typologie.famille === typ
  return d.typologie.variante === typ
}

function correspondClient(d: DevisResume, client: string): boolean {
  const a = normaliser(d.clientNom)
  const b = normaliser(client)
  if (!b) return true
  return a.includes(b) || b.includes(a)
}

// Filtre les devis et calcule l'agregat demande UNIQUEMENT a partir des vraies
// donnees (subtotal HT en centimes). Aucun nombre n'est invente ici.
export function executerRequete(
  intent: IntentRequete,
  devis: DevisResume[],
): ResultatRequete {
  let base = devis
  // Client : passe EXACTE d'abord (inclusion de sous-chaine, comportement
  // historique), puis passe SOUPLE en secours si l'exacte ne trouve rien (faute
  // de frappe / variante, ex « Lemoinne » vs « Lemoine »), via le module partage
  // matching-nom. Une correspondance trouvee en souple est signalee comme
  // approchante (le redacteur invite a confirmer). Le souple ne se declenche que
  // sur la dimension CLIENT ; typologie/periode s'appliquent ensuite, inchanges.
  let correspondanceApprochante = false
  if (intent.client) {
    const exact = base.filter((d) => correspondClient(d, intent.client!))
    if (exact.length > 0) {
      base = exact
    } else {
      const souple = base.filter((d) => correspondNomSouple(intent.client!, d.clientNom))
      base = souple
      correspondanceApprochante = souple.length > 0
    }
  }
  if (intent.typologie) base = base.filter((d) => correspondTypologie(d, intent.typologie!))
  if (intent.periode) {
    const { debut, fin } = intent.periode
    base = base.filter((d) => d.dateISO && (!debut || d.dateISO >= debut) && (!fin || d.dateISO <= fin))
  }

  const sommeC = base.reduce((s, d) => s + d.montantHTCentimes, 0)
  let agregat: ResultatRequete['agregat'] = null
  let devisOrdonnes = [...base].sort((a, b) => (b.dateISO ?? '').localeCompare(a.dateISO ?? ''))

  switch (intent.agregat) {
    case 'somme':
      agregat = { type: 'somme', valeurCentimes: sommeC, valeurNombre: null }
      break
    case 'moyenne':
      agregat = { type: 'moyenne', valeurCentimes: base.length ? Math.round(sommeC / base.length) : 0, valeurNombre: null }
      break
    case 'max': {
      const m = base.reduce<DevisResume | null>((mx, d) => (!mx || d.montantHTCentimes > mx.montantHTCentimes ? d : mx), null)
      agregat = { type: 'max', valeurCentimes: m?.montantHTCentimes ?? null, valeurNombre: null }
      if (m) devisOrdonnes = [m]
      break
    }
    case 'min': {
      const m = base.reduce<DevisResume | null>((mn, d) => (!mn || d.montantHTCentimes < mn.montantHTCentimes ? d : mn), null)
      agregat = { type: 'min', valeurCentimes: m?.montantHTCentimes ?? null, valeurNombre: null }
      if (m) devisOrdonnes = [m]
      break
    }
    case 'compte':
      agregat = { type: 'compte', valeurCentimes: null, valeurNombre: base.length }
      break
    default:
      agregat = null
  }

  if (intent.intention === 'top_montant') {
    devisOrdonnes = [...base].sort((a, b) => b.montantHTCentimes - a.montantHTCentimes).slice(0, intent.limite ?? 3)
  }

  return {
    intention: intent.intention,
    filtres: { client: intent.client, typologie: intent.typologie, periode: intent.periode },
    nbDevis: base.length,
    devis: devisOrdonnes,
    agregat,
    correspondanceApprochante,
  }
}

// ---------- 3) Rédaction de la réponse (Claude, a partir des FAITS) ----------

const fmtEuros = (centimes: number): string =>
  (centimes / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

// Construit l'objet de FAITS deja calcules (montants en euros) passe a Claude.
function construireFaits(resultat: ResultatRequete) {
  const LIMITE_LISTE = 20
  return {
    nombre_de_devis: resultat.nbDevis,
    correspondance_approchante: resultat.correspondanceApprochante,
    agregat: resultat.agregat
      ? {
          type: resultat.agregat.type,
          valeur: resultat.agregat.valeurCentimes != null ? fmtEuros(resultat.agregat.valeurCentimes) : resultat.agregat.valeurNombre,
        }
      : null,
    filtres: resultat.filtres,
    devis: resultat.devis.slice(0, LIMITE_LISTE).map((d) => ({
      numero: d.numero,
      client: d.clientNom,
      date: d.dateISO,
      montant_ht: fmtEuros(d.montantHTCentimes),
      typologie: d.typologie.variante ?? d.typologie.famille ?? 'non determinee',
      statut: d.statut,
    })),
    devis_tronques: Math.max(0, resultat.devis.length - LIMITE_LISTE),
  }
}

function promptRedaction(question: string, faits: any): string {
  return `Tu es l'assistant de consultation des devis d'Olivier (artisan façades). Tu reponds en français, de maniere claire et concise, UNIQUEMENT a partir des FAITS fournis ci-dessous, qui proviennent de ses vraies donnees.

QUESTION D'OLIVIER :
${question}

FAITS (deja calcules a partir des vraies donnees, montants en euros) :
${JSON.stringify(faits, null, 2)}

REGLES STRICTES :
- N'invente AUCUN chiffre. Tous les montants, moyennes et comptes que tu cites doivent venir EXACTEMENT des FAITS ci-dessus (champ "agregat" ou "montant_ht" des devis). Ne recalcule rien toi-meme.
- Si "nombre_de_devis" vaut 0, dis clairement qu'aucun devis ne correspond a la demande, sans inventer.
- Si "correspondance_approchante" vaut true, le nom de client demande ne correspond pas exactement a celui des devis trouves (faute de frappe ou variante). Cite le nom EXACT du client tel qu'il figure dans les devis (champ "client") et invite Olivier a confirmer que c'est bien le bon client (ex : "j'ai trouve des devis pour <nom exact>, est-ce bien ce client ?"). N'invente aucun nom.
- Reprends les montants tels quels (format euros fourni). Tu peux citer le client, la date, la typologie et le numero des devis.
- Si "devis_tronques" est superieur a 0, precise que tu ne montres que les premiers (par ex. les 20 premiers).
- Reste factuel et bref. Pas de relance commerciale, pas de conseil non demande. Tu ne fais que consulter et restituer.
- Tu ne peux RIEN creer ni modifier : tu es en lecture seule.`
}

export async function redigerReponse(
  question: string,
  resultat: ResultatRequete,
): Promise<string> {
  const faits = construireFaits(resultat)
  const rep = await anthropic.messages.create({
    model: MODELE_CLAUDE,
    max_tokens: 700,
    messages: [{ role: 'user', content: promptRedaction(question, faits) }],
  })
  return rep.content[0]?.type === 'text' ? rep.content[0].text.trim() : ''
}

// ---------- Donnees devis d'UN client (pour le recap, additif) ----------

// Renvoie les devis d'un client (resumes + total HT en euros), pour le recap
// client. Passe EXACTE puis SOUPLE en secours (meme matching que la recherche
// devis ciblee) ; tri date decroissante. N'ANALYSE PAS la question et NE REDIGE
// PAS : fonction de DONNEES (lecture seule, GET). repondreQuestion reste inchange.
export async function devisPourClient(
  nom: string,
  devisPreCharges?: DevisResume[],
): Promise<{
  nombre: number
  approchant: boolean
  total_ht: string
  devis: { numero: string | null; date: string | null; montant_ht: string; typologie: string; statut: string }[]
}> {
  const tous = devisPreCharges ?? (await listerDevisCompteTest())
  const r = (nom ?? '').trim()
  if (!r) return { nombre: 0, approchant: false, total_ht: fmtEuros(0), devis: [] }
  let base = tous.filter((d) => correspondClient(d, r))
  let approchant = false
  if (base.length === 0) {
    base = tous.filter((d) => correspondNomSouple(r, d.clientNom))
    approchant = base.length > 0
  }
  base = [...base].sort((a, b) => (b.dateISO ?? '').localeCompare(a.dateISO ?? ''))
  const totalC = base.reduce((s, d) => s + d.montantHTCentimes, 0)
  return {
    nombre: base.length,
    approchant,
    total_ht: fmtEuros(totalC),
    devis: base.map((d) => ({
      numero: d.numero,
      date: d.dateISO,
      montant_ht: fmtEuros(d.montantHTCentimes),
      typologie: d.typologie.variante ?? d.typologie.famille ?? 'non determinee',
      statut: d.statut,
    })),
  }
}

// ---------- Orchestrateur ----------

export interface ReponseAssistant {
  reponse: string
  intent: IntentRequete
  resultat: ResultatRequete
  // Client effectivement traite (pour le contexte de conversation), repris du
  // contexte si suivi. null si la question n'etait pas portee sur un client precis.
  clientResolu: string | null
}

// Repond a une question en langage naturel sur l'historique des devis (lecture
// seule). `aujourdhui` (YYYY-MM-DD) sert a interpreter les periodes relatives ;
// `devisPreCharges` evite de relire la liste a chaque question dans les tests.
// `clientContexte` : dernier client evoque, repris si la question est un suivi
// (« et ses devis ? ») sans nommer personne.
export async function repondreQuestion(
  question: string,
  aujourdhui: string,
  devisPreCharges?: DevisResume[],
  clientContexte?: string | null,
  // Memoire de conversation : aide l'analyse a resoudre une reference (compréhension).
  historique?: MessageHistorique[] | null,
): Promise<ReponseAssistant> {
  const devis = devisPreCharges ?? (await listerDevisCompteTest())
  const intent = await analyserQuestion(question, aujourdhui, historique)

  // Suivi de conversation : on reprend le client du contexte si la question fait
  // reference au client precedent sans le nommer (« et ses devis ? »). Reprise EN
  // CODE, deterministe. Les questions generales (« mon prix moyen », « mes 3 plus
  // gros devis »...) n'ont pas de referent (« mon/mes ») => pas de reprise.
  if (
    !intent.client &&
    clientContexte &&
    clientContexte.trim() &&
    faitReferenceClientPrecedent(question)
  ) {
    intent.client = clientContexte.trim()
  }

  const resultat = executerRequete(intent, devis)
  const reponse = await redigerReponse(question, resultat)
  return { reponse, intent, resultat, clientResolu: intent.client }
}
