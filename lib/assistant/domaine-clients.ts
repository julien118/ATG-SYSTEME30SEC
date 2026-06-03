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
import { listerContacts } from '../costructor'
import { redigerDepuisFaits } from './rediger'
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

// ---------- Normalisation + jetons de nom ----------

function normaliser(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Civilites et particules a ignorer dans le matching de nom (meme logique que les
// comptes rendus) : "M. Dupont" doit retrouver "M. et Mme Dupont".
const MOTS_VIDES_NOM = new Set([
  'm', 'mr', 'mme', 'mlle', 'monsieur', 'madame', 'mademoiselle',
  'et', 'de', 'du', 'des', 'la', 'le', 'les', 'l', 'aux', 'a',
])

function jetonsSignificatifs(nom: string): string[] {
  return normaliser(nom)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !MOTS_VIDES_NOM.has(t))
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

// ---------- Filtres en code (purs) ----------

// Matching par jetons : TOUS les jetons significatifs de la recherche doivent
// etre presents dans le nom du contact. Repli sur l'inclusion brute si la
// recherche ne contient que des civilites.
function correspondNom(c: CostructorContact, recherche: string): boolean {
  const cible = normaliser(nomContact(c))
  const r = normaliser(recherche)
  if (!r) return true
  const jetons = jetonsSignificatifs(recherche)
  if (jetons.length === 0) return cible.includes(r) || r.includes(cible)
  return jetons.every((t) => cible.includes(t))
}

function correspondVille(c: CostructorContact, ville: string): boolean {
  const v = normaliser(ville)
  if (!v) return true
  return adressesContact(c).some((a) => normaliser(a.ville).includes(v))
}

// ---------- Bornage : resume vs coordonnees completes ----------

// Resume BORNE d'un contact (pour les listes et les homonymes) : nom + ville +
// un email et un telephone, pas toutes les coordonnees.
function resumeContact(c: CostructorContact) {
  const adr = adressesContact(c)
  const principale = adr.find((a) => a.principale) ?? adr[0] ?? null
  return {
    nom: nomContact(c),
    ville: principale?.ville ?? null,
    email: emailsContact(c)[0] ?? null,
    telephone: telephonesContact(c)[0] ?? null,
  }
}

// Coordonnees COMPLETES d'un contact (un seul, petit) : tous emails, telephones,
// adresses.
function coordonneesCompletes(c: CostructorContact) {
  return {
    nom: nomContact(c),
    type: c.type,
    emails: emailsContact(c),
    telephones: telephonesContact(c),
    adresses: adressesContact(c),
  }
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
  const tous = contactsPreCharges ?? (await listerContacts())
  const intent = await analyserQuestionClients(question)

  // Liste "mes clients" : PRECISE, restreinte aux vrais clients (type 'client').
  if (intent.intention === 'liste_clients') {
    let base = tous.filter((c) => c.type === 'client')
    if (intent.ville) base = base.filter((c) => correspondVille(c, intent.ville!))
    base = [...base].sort((a, b) => nomContact(a).localeCompare(nomContact(b)))
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

  // Fiche / recherche par nom : LARGE, dans les contacts humains (client + lead).
  let base = tous.filter((c) => c.type === 'client' || c.type === 'lead')
  if (intent.client) base = base.filter((c) => correspondNom(c, intent.client!))
  if (intent.ville) base = base.filter((c) => correspondVille(c, intent.ville!))

  let faits: unknown
  if (!intent.client) {
    // Aucun nom fourni : on ne fabrique pas de fiche, on invite a preciser.
    faits = { mode: 'aucun_nom', message: 'aucun nom de client n\'a ete fourni dans la question' }
  } else if (base.length === 1) {
    faits = { mode: 'fiche_client', client: coordonneesCompletes(base[0]) }
  } else if (base.length === 0) {
    faits = { mode: 'aucun_resultat', recherche: intent.client, ville: intent.ville }
  } else {
    faits = {
      mode: 'plusieurs_correspondances',
      recherche: intent.client,
      nombre: base.length,
      invitation_a_preciser: true,
      clients: base.slice(0, LIMITE_LISTE).map(resumeContact),
      clients_tronques: Math.max(0, base.length - LIMITE_LISTE),
    }
  }

  const reponse = await redigerDepuisFaits({ question, sujet: 'fichier clients', faits })
  return { reponse, nbContacts: base.length }
}
