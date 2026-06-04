// =============================================================
// Domaine "clients" de l'assistant (lecture seule, Costructor /contacts)
// =============================================================
// Meme chaine en trois temps que les autres domaines, sur les contacts Costructor :
//   1. analyserQuestionClients : Claude traduit la question en filtres (JSON).
//   2. code PUR : GET /contacts (listerContacts, deja utilise pour la dedup),
//      filtre par jetons du nom / ville, puis BORNAGE. Aucune coordonnee inventee.
//   3. redigerDepuisFaits (redacteur partage) : Claude redige a partir des FAITS.
//
// LECTURE SEULE STRICTE : GET uniquement, jamais d'ecriture. Compte test.
//
// PERIMETRE (valide) : recherche LARGE, liste PRECISE.
//   - recherche par nom (fiche client) : on cherche dans les contacts HUMAINS
//     (type 'client' ET 'lead'), pour ne jamais rater quelqu'un qu'Olivier nomme
//     meme si c'est encore un prospect ;
//   - liste "mes clients" : restreinte aux vrais clients (type 'client').
//
// BORNAGE (critique : ~308 contacts sur le compte test, on n'en donne jamais 308
// d'un coup au LLM) :
//   - un seul contact trouve -> coordonnees COMPLETES (c'est petit) ;
//   - plusieurs (homonymes) -> resume borne + invitation a preciser ;
//   - liste "mes clients" -> plafonnee, avec signal de troncature.
//
// Le croisement "les devis de tel client" n'est PAS traite ici : il est deja
// couvert par le domaine devis (intention liste_client). Domaines separes et nets.

import { anthropic } from '../anthropic'
import { listerContacts, parseAdresseFr } from '../costructor'
import { createAdminClient } from '../supabase/admin'
import { ATG_USER_ID } from '../atg'
import { redigerDepuisFaits } from './rediger'
import { normaliser, jetonsSignificatifs, correspondNomSouple } from './matching-nom'
import type { CostructorContact } from '../types'

const MODELE_CLAUDE = 'claude-sonnet-4-20250514'
// Plafond du nombre de contacts resumes envoyes au redacteur (bornage).
const LIMITE_LISTE = 15

// ---------- Types ----------

export interface IntentClients {
  intention: 'fiche_client' | 'liste_clients' | 'inconnu'
  client: string | null
  ville: string | null
}

// Fiche unifiee (commit 1) : forme commune aux DEUX sources, pour que le matching,
// le bornage et la redaction operent de maniere uniforme.
//   - origine 'costructor' : un contact du compte Costructor (GET lecture seule) ;
//   - origine 'app'        : une fiche/visite enregistree dans l'app (table
//     chantiers, SELECT lecture seule) pas forcement encore poussee en devis.
export interface AdresseFiche {
  rue: string | null
  ville: string | null
  code_postal: string | null
  pays: string | null
  principale: boolean
}
export interface FicheClient {
  nom: string
  emails: string[]
  telephones: string[]
  adresses: AdresseFiche[]
  origine: 'costructor' | 'app'
  type: 'client' | 'lead' | 'app'
  statutApp: string | null // statut du chantier pour les fiches app, sinon null
}

// ---------- Extraction des coordonnees (champs reels) ----------

function nomContact(c: CostructorContact): string {
  return (
    (c.fullName?.trim() || '') ||
    [c.firstName, c.lastName].filter(Boolean).join(' ').trim() ||
    (c.companyName?.trim() || '') ||
    '(sans nom)'
  )
}

function emailsContact(c: CostructorContact): string[] {
  const liste = (c.emails ?? []).map((e) => e.email).filter(Boolean)
  if (!liste.length && c.email) liste.push(c.email)
  return Array.from(new Set(liste))
}

function telephonesContact(c: CostructorContact): string[] {
  const liste = (c.phones ?? []).map((p) => p.phone).filter(Boolean)
  if (!liste.length && c.phone) liste.push(c.phone)
  return Array.from(new Set(liste))
}

function adressesContact(c: CostructorContact) {
  return (c.addresses ?? [])
    .map((a) => {
      const ad = a.address ?? {}
      return {
        rue: ad.street ?? null,
        ville: ad.city ?? null,
        code_postal: ad.postal_code ?? null,
        pays: ad.country ?? null,
        principale: !!a.primary,
      }
    })
    .filter((a) => a.rue || a.ville || a.code_postal)
}

// ---------- Construction des fiches unifiees (2 sources, lecture seule) ----------

// Costructor (GET) -> FicheClient. Le type est ramene a 'client' ou 'lead'.
function ficheDepuisContact(c: CostructorContact): FicheClient {
  return {
    nom: nomContact(c),
    emails: emailsContact(c),
    telephones: telephonesContact(c),
    adresses: adressesContact(c),
    origine: 'costructor',
    type: c.type === 'client' ? 'client' : 'lead',
    statutApp: null,
  }
}

// Forme partielle d'un chantier app utile a la fiche client.
interface ChantierFiche {
  client_nom: string | null
  client_adresse: string | null
  client_telephone: string | null
  client_email: string | null
  statut: string | null
}

// Fiche app (table chantiers) -> FicheClient. L'adresse libre est decoupee via
// parseAdresseFr (rue/ville/cp) pour que la recherche par ville fonctionne aussi.
function ficheDepuisChantier(ch: ChantierFiche): FicheClient {
  const { street, city, zip } = parseAdresseFr(ch.client_adresse)
  const adresses: AdresseFiche[] =
    street || city || zip
      ? [{ rue: street || null, ville: city || null, code_postal: zip || null, pays: 'FR', principale: true }]
      : []
  return {
    nom: (ch.client_nom ?? '').trim() || '(sans nom)',
    emails: ch.client_email ? [ch.client_email] : [],
    telephones: ch.client_telephone ? [ch.client_telephone] : [],
    adresses,
    origine: 'app',
    type: 'app',
    statutApp: ch.statut ?? null,
  }
}

// Charge les fiches de l'app (table chantiers, SELECT lecture seule, filtre user
// ATG). Aucune ecriture. On ecarte les chantiers sans nom exploitable.
async function chargerFichesApp(): Promise<FicheClient[]> {
  const sb = createAdminClient()
  const { data, error } = await sb
    .from('chantiers')
    .select('client_nom, client_adresse, client_telephone, client_email, statut')
    .eq('user_id', ATG_USER_ID)
  if (error) return []
  return (data as ChantierFiche[] | null ?? [])
    .filter((ch) => (ch.client_nom ?? '').trim())
    .map(ficheDepuisChantier)
}

// Fusion + dedup par nom normalise, COSTRUCTOR PRIORITAIRE (1re occurrence
// gardee) : une meme personne presente dans les deux sources n'apparait qu'une
// fois, via son contact Costructor (canonique). Une fiche app-only reste.
function fusionnerEtDedupliquer(
  costructor: FicheClient[],
  app: FicheClient[],
): FicheClient[] {
  const vus = new Set<string>()
  const out: FicheClient[] = []
  for (const f of [...costructor, ...app]) {
    const cle = normaliser(f.nom)
    if (!cle || vus.has(cle)) continue
    vus.add(cle)
    out.push(f)
  }
  return out
}

// ---------- Filtres en code (purs, sur FicheClient) ----------

// Matching par jetons : TOUS les jetons significatifs de la recherche doivent
// etre presents dans le nom. Repli sur l'inclusion brute si la recherche ne
// contient que des civilites. (Passe EXACTE ; le souple arrive au commit 2.)
function correspondNom(f: FicheClient, recherche: string): boolean {
  const cible = normaliser(f.nom)
  const r = normaliser(recherche)
  if (!r) return true
  const jetons = jetonsSignificatifs(recherche)
  if (jetons.length === 0) return cible.includes(r) || r.includes(cible)
  return jetons.every((t) => cible.includes(t))
}

function correspondVille(f: FicheClient, ville: string): boolean {
  const v = normaliser(ville)
  if (!v) return true
  return f.adresses.some((a) => normaliser(a.ville).includes(v))
}

// Resolution d'un client par NOM dans les DEUX sources fusionnees (contacts
// Costructor client+lead + fiches app), passe EXACTE puis SOUPLE en secours, sans
// filtre ville. Factorisee ici pour etre reutilisee par repondreQuestionClients
// ET par le recap client (lecture seule : GET contacts + SELECT chantiers).
// `approchant` = true quand la resolution a du passer par le souple (faute de
// frappe). Renvoie [] si aucun nom n'est fourni.
export async function trouverFichesClient(
  nom: string,
  contactsPreCharges?: CostructorContact[],
): Promise<{ fiches: FicheClient[]; approchant: boolean }> {
  const contacts = contactsPreCharges ?? (await listerContacts())
  const fichesCostructor = contacts
    .filter((c) => c.type === 'client' || c.type === 'lead')
    .map(ficheDepuisContact)
  const fichesApp = await chargerFichesApp()
  const unifiees = fusionnerEtDedupliquer(fichesCostructor, fichesApp)
  const r = (nom ?? '').trim()
  if (!r) return { fiches: [], approchant: false }
  const exact = unifiees.filter((f) => correspondNom(f, r))
  if (exact.length > 0) return { fiches: exact, approchant: false }
  const souple = unifiees.filter((f) => correspondNomSouple(r, f.nom))
  return { fiches: souple, approchant: souple.length > 0 }
}

// ---------- Bornage : resume vs coordonnees completes ----------

// Resume BORNE d'une fiche (listes et homonymes) : nom + ville + un email + un
// telephone + l'origine (Costructor ou app).
export function resumeContact(f: FicheClient) {
  const principale = f.adresses.find((a) => a.principale) ?? f.adresses[0] ?? null
  return {
    nom: f.nom,
    ville: principale?.ville ?? null,
    email: f.emails[0] ?? null,
    telephone: f.telephones[0] ?? null,
    origine: f.origine,
  }
}

// Coordonnees COMPLETES d'une fiche (une seule, petit) : tous emails, telephones,
// adresses. On expose le type (client/lead) seulement pour un contact Costructor
// (info utile) ; l'origine app est signalee a part via le drapeau `origine_app`
// des faits (pas ici, pour ne pas afficher de bruit type « Origine : costructor »).
export function coordonneesCompletes(f: FicheClient) {
  const c: Record<string, unknown> = {
    nom: f.nom,
    emails: f.emails,
    telephones: f.telephones,
    adresses: f.adresses,
  }
  if (f.origine === 'costructor') c.type = f.type
  return c
}

// ---------- 1) Analyse de la question (Claude -> intent JSON) ----------

function promptAnalyseClients(question: string): string {
  return `Tu analyses une question d'Olivier (artisan façades) sur SES clients/contacts. Tu ne reponds PAS : tu la traduis en filtres structures.

QUESTION :
---
${question}
---

Reponds STRICTEMENT en JSON valide (aucun texte autour, pas de markdown), schema EXACT :
{
  "intention": "fiche_client | liste_clients | inconnu",
  "client": "<nom de la personne ou de l'entreprise recherchee, ou null>",
  "ville": "<ville si precisee, ou null>"
}

REGLES :
- "fiche_client" : la question vise les coordonnees d'une personne/entreprise precise (adresse, telephone, email, "les coordonnees de...", "la fiche de...", "ou habite...").
- "liste_clients" : la question demande l'ensemble ou une partie de ses clients ("mes clients", "mes clients a Tours", "combien de clients").
- "inconnu" : ne correspond a aucun des deux.
- "client" : le nom recherche pour une fiche, sinon null.
- "ville" : uniquement si une ville est explicitement citee, sinon null.
- N'invente aucun filtre non demande.`
}

function extraireJson(texte: string): any {
  const m = texte.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('Aucun JSON dans la reponse d\'analyse clients.')
  return JSON.parse(m[0])
}

export async function analyserQuestionClients(question: string): Promise<IntentClients> {
  const rep = await anthropic.messages.create({
    model: MODELE_CLAUDE,
    max_tokens: 300,
    temperature: 0,
    messages: [{ role: 'user', content: promptAnalyseClients(question) }],
  })
  const texte = rep.content[0]?.type === 'text' ? rep.content[0].text : ''
  const p = extraireJson(texte)
  return {
    intention: p.intention ?? 'inconnu',
    client: p.client ?? null,
    ville: p.ville ?? null,
  }
}

// ---------- 2+3) Orchestration du domaine ----------

export interface ReponseClients {
  reponse: string
  nbContacts: number
}

export async function repondreQuestionClients(
  question: string,
  contactsPreCharges?: CostructorContact[],
): Promise<ReponseClients> {
  const contactsCostructor = contactsPreCharges ?? (await listerContacts())
  const intent = await analyserQuestionClients(question)

  // Liste "mes clients" : PRECISE, restreinte aux VRAIS clients Costructor
  // (type 'client'). On n'y ajoute PAS les fiches app : une visite planifiee
  // n'est pas encore un client (decision validee).
  if (intent.intention === 'liste_clients') {
    let base = contactsCostructor.filter((c) => c.type === 'client').map(ficheDepuisContact)
    if (intent.ville) base = base.filter((f) => correspondVille(f, intent.ville!))
    base = [...base].sort((a, b) => a.nom.localeCompare(b.nom))
    const faits = {
      mode: 'liste_clients',
      nombre_de_clients: base.length,
      filtres: { ville: intent.ville },
      clients: base.slice(0, LIMITE_LISTE).map(resumeContact),
      clients_tronques: Math.max(0, base.length - LIMITE_LISTE),
    }
    const reponse = await redigerDepuisFaits({ question, sujet: 'fichier clients', faits })
    return { reponse, nbContacts: base.length }
  }

  // Fiche / recherche par nom : resolution dans les DEUX sources (Costructor
  // client+lead + fiches app), exacte puis souple, deleguee a trouverFichesClient
  // (factorisee, reutilisee par le recap client). On applique ENSUITE le filtre
  // ville, comme avant. On NE deverse jamais tout au modele : on borne plus bas.
  let base: FicheClient[] = []
  let correspondanceApprochante = false
  if (intent.client) {
    const res = await trouverFichesClient(intent.client, contactsCostructor)
    base = res.fiches
    correspondanceApprochante = res.approchant
  }
  if (intent.ville) base = base.filter((f) => correspondVille(f, intent.ville!))

  let faits: unknown
  if (!intent.client) {
    // Aucun nom fourni : on ne fabrique pas de fiche, on invite a preciser.
    faits = { mode: 'aucun_nom', message: 'aucun nom de client n\'a ete fourni dans la question' }
  } else if (base.length === 1) {
    // Signal d'origine (point 3) : si la fiche vient de l'app et n'est pas encore
    // poussee en devis, on le signale au redacteur (champ origine_app).
    const seule = base[0]
    faits = {
      mode: 'fiche_client',
      client: coordonneesCompletes(seule),
      origine_app: seule.origine === 'app',
      correspondance_approchante: correspondanceApprochante,
    }
  } else if (base.length === 0) {
    faits = { mode: 'aucun_resultat', recherche: intent.client, ville: intent.ville }
  } else {
    faits = {
      mode: 'plusieurs_correspondances',
      recherche: intent.client,
      nombre: base.length,
      invitation_a_preciser: true,
      correspondance_approchante: correspondanceApprochante,
      clients: base.slice(0, LIMITE_LISTE).map(resumeContact),
      clients_tronques: Math.max(0, base.length - LIMITE_LISTE),
    }
  }

  const reponse = await redigerDepuisFaits({ question, sujet: 'fichier clients', faits })
  return { reponse, nbContacts: base.length }
}
