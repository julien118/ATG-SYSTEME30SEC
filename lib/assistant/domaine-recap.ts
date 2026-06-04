// =============================================================
// Domaine "recap client" de l'assistant (lecture seule)
// =============================================================
// Repond a une demande GLOBALE sur un client (« tout sur X », « recap de X »,
// « resume le dossier de X ») en rassemblant ses COORDONNEES + ses COMPTES RENDUS
// + ses DEVIS en UNE seule reponse. Architecture (option B validee) :
//   1. on resout le client UNE seule fois (trouverFichesClient) -> jamais deux
//      homonymes melanges ;
//   2. on rassemble les donnees structurees des trois domaines (fonctions
//      « donnees par client » exposees au commit 1), bornees ;
//   3. on construit UN objet FAITS unique (montants en euros, comptes reels) ;
//   4. UNE seule redaction, via un prompt DEDIE au recap (3 sections).
//
// LECTURE SEULE STRICTE : GET Costructor (contacts + quotes) + SELECT Supabase
// (rapports/chantiers). Aucune ecriture. Anti-hallucination : le redacteur ne
// cite QUE les FAITS pre-calcules par le code.

import { anthropic } from '../anthropic'
import {
  analyserQuestionClients,
  trouverFichesClient,
  coordonneesCompletes,
  resumeContact,
} from './domaine-clients'
import { comptesRendusPourClient } from './domaine-comptes-rendus'
import { devisPourClient } from '../devis-historique'

const MODELE_CLAUDE = 'claude-sonnet-4-20250514'
// Bornage par section : on ne deverse jamais tout au modele.
const MAX_CR = 5
const MAX_DEVIS = 10

export interface ReponseRecap {
  reponse: string
  nb: number
}

// Prompt DEDIE au recap : 3 sections, anti-hallucination stricte.
function promptRecap(question: string, faits: unknown): string {
  return `Tu es l'assistant d'Olivier (artisan façades : ravalement et ITE). Olivier te demande un RECAPITULATIF complet d'un client. Tu reponds en français, clair et structure, UNIQUEMENT a partir des FAITS fournis (ses vraies donnees).

QUESTION D'OLIVIER :
${question}

FAITS (deja recuperes et calcules par le code a partir des vraies donnees) :
${JSON.stringify(faits, null, 2)}

REGLES STRICTES :
- N'invente RIEN. Chaque coordonnee, observation, date, numero ou montant que tu cites doit apparaitre EXACTEMENT dans les FAITS. Ne recalcule rien, ne complete rien, ne melange JAMAIS deux clients.
- Si "mode" vaut "aucun_nom" : demande simplement de quel client il s'agit.
- Si "mode" vaut "plusieurs_clients" : ne fais PAS de recap ; liste les clients proposes (champ "candidats") et invite Olivier a preciser lequel.
- Si "mode" vaut "aucun" : dis clairement qu'aucun client ne correspond, sans inventer.
- Si "mode" vaut "recap_client" : presente le recap en TROIS sections, dans cet ordre :
  1. "Coordonnees" : a partir de "coordonnees". Si "coordonnees" vaut null, ecris "Coordonnees non trouvees dans le fichier." Si "origine_app" vaut true, ajoute simplement : "Il s'agit d'une visite enregistree dans l'app, le devis n'a pas encore ete envoye."
  2. "Comptes rendus" : a partir de "comptes_rendus". Si la liste est vide, ecris "Aucun compte rendu." Pour chacun : date, objet et titres d'observations. Si "comptes_rendus.autres" > 0, precise "… et N autres comptes rendus".
  3. "Devis" : a partir de "devis". Si la liste est vide, ecris "Aucun devis." Pour chacun : date, numero, montant (champ "montant_ht"), typologie, statut. Indique le total (champ "devis.total_ht"). Si "devis.autres" > 0, precise "… et N autres devis".
- Si "correspondance_approchante" vaut true, le nom demande ne correspond pas exactement a celui retrouve (faute de frappe). Cite le nom EXACT et invite a confirmer que c'est bien le bon client.
- Reste factuel et concis. Pas de relance commerciale. Tu es en LECTURE SEULE.`
}

async function rediger(question: string, faits: unknown): Promise<string> {
  const rep = await anthropic.messages.create({
    model: MODELE_CLAUDE,
    max_tokens: 1100,
    temperature: 0,
    messages: [{ role: 'user', content: promptRecap(question, faits) }],
  })
  return rep.content[0]?.type === 'text' ? rep.content[0].text.trim() : ''
}

// Recap complet d'un client en une question. Resout le client une seule fois,
// rassemble les 3 sources, construit un FAITS unique, redige une seule fois.
export async function repondreRecapClient(question: string): Promise<ReponseRecap> {
  // 1. Nom du client (on reutilise l'analyse du domaine clients).
  const intent = await analyserQuestionClients(question)
  const nom = (intent.client ?? '').trim()
  if (!nom) {
    const reponse = await rediger(question, { mode: 'aucun_nom' })
    return { reponse, nb: 0 }
  }

  // 2. Resolution du client UNE seule fois (exact puis souple, dedup).
  const { fiches, approchant: approchantFiche } = await trouverFichesClient(nom)

  // Plusieurs homonymes : on ne melange pas, on invite a preciser.
  if (fiches.length > 1) {
    const reponse = await rediger(question, {
      mode: 'plusieurs_clients',
      recherche: nom,
      candidats: fiches.map(resumeContact),
    })
    return { reponse, nb: fiches.length }
  }

  // Identite cible : nom canonique de la fiche unique, sinon le nom demande (edge
  // « pas de fiche mais des CR/devis »).
  const fiche = fiches[0] ?? null
  const nomCible = fiche?.nom ?? nom

  // 3. Rassembler CR + devis pour cette identite (en parallele, lecture seule).
  const [cr, dv] = await Promise.all([
    comptesRendusPourClient(nomCible),
    devisPourClient(nomCible),
  ])

  // Edge : aucune fiche ET aucun CR/devis -> aucun client.
  if (!fiche && cr.nombre === 0 && dv.nombre === 0) {
    const reponse = await rediger(question, { mode: 'aucun', recherche: nom })
    return { reponse, nb: 0 }
  }

  // 4. Objet FAITS unique (borne par section).
  const approchante = approchantFiche || (!fiche && (cr.approchant || dv.approchant))
  const faits = {
    mode: 'recap_client',
    client_recherche: nom,
    correspondance_approchante: approchante,
    coordonnees: fiche ? coordonneesCompletes(fiche) : null,
    origine_app: fiche?.origine === 'app',
    comptes_rendus: {
      nombre: cr.nombre,
      liste: cr.comptesRendus.slice(0, MAX_CR),
      autres: Math.max(0, cr.nombre - MAX_CR),
    },
    devis: {
      nombre: dv.nombre,
      total_ht: dv.total_ht,
      liste: dv.devis.slice(0, MAX_DEVIS),
      autres: Math.max(0, dv.nombre - MAX_DEVIS),
    },
  }

  const reponse = await rediger(question, faits)
  return { reponse, nb: cr.nombre + dv.nombre }
}
