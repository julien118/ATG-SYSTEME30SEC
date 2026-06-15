// =============================================================
// Redacteur generique partage par les domaines de l'assistant
// =============================================================
// Etape 3 de la chaine (commune a tous les nouveaux domaines) : Claude redige une
// reponse en français UNIQUEMENT a partir d'un objet de FAITS deja recuperes,
// filtres et calcules par le code du domaine. Il ne calcule rien, n'invente rien.
//
// NB : le domaine "devis" garde son propre redacteur historique
// (lib/devis-historique.ts), inchange. Ce redacteur sert aux domaines ajoutes
// a partir de l'etape A+B (comptes rendus, puis clients...).

import { anthropic, MODELE_CLAUDE } from '../anthropic'

// Redige a partir des FAITS. `sujet` rappelle au modele la nature des donnees
// (ex : "comptes rendus de visite") ; `faits` est l'objet borne construit par le
// domaine. Anti-hallucination : tout ce que le modele cite doit venir des FAITS.
export async function redigerDepuisFaits(args: {
  question: string
  sujet: string
  faits: unknown
}): Promise<string> {
  const prompt = `Tu es l'assistant d'Olivier (artisan façades : ravalement et ITE). Tu reponds en français, de maniere claire et concise, UNIQUEMENT a partir des FAITS fournis ci-dessous, qui proviennent de ses vraies donnees (${args.sujet}).

QUESTION D'OLIVIER :
${args.question}

FAITS (deja recuperes, filtres et calcules par le code a partir des vraies donnees) :
${JSON.stringify(args.faits, null, 2)}

REGLES STRICTES :
- N'invente RIEN. Chaque observation, mesure, nom de client, date ou chiffre que tu cites doit apparaitre EXACTEMENT dans les FAITS ci-dessus. Ne deduis pas, ne complete pas, ne recalcule rien toi-meme.
- Si les FAITS indiquent qu'aucun element ne correspond a la demande, dis-le clairement, sans inventer.
- Si les FAITS signalent plusieurs correspondances pour un meme nom, restitue-les et invite Olivier a preciser (le client, la date) plutot que d'en choisir une au hasard.
- Si les FAITS indiquent "correspondance_approchante": true, c'est que le nom demande ne correspond pas exactement a celui retrouve (faute de frappe ou variante). Reponds en citant le nom EXACT present dans les FAITS et invite Olivier a confirmer que c'est bien le bon chantier (ex : "j'ai trouve un compte rendu pour <nom exact des FAITS>, est-ce bien celui-la ?"). N'invente aucun nom : reprends uniquement celui des FAITS.
- Si les FAITS indiquent "origine_app": true (ou un client dont "origine" vaut "app"), c'est une visite enregistree dans l'application dont le devis n'a pas encore ete envoye. Signale-le simplement et sans jargon, par exemple : "Il s'agit d'une visite enregistree dans l'app, le devis n'a pas encore ete envoye." N'invente rien d'autre.
- Si les FAITS signalent que la liste est tronquee, precise que tu ne montres que les premiers elements.
- Reste factuel et bref. Pas de relance commerciale, pas de conseil non demande.
- Tu es en LECTURE SEULE : tu ne peux rien creer ni modifier, seulement consulter et restituer.`

  const rep = await anthropic.messages.create({
    model: MODELE_CLAUDE,
    max_tokens: 700,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  })
  return rep.content[0]?.type === 'text' ? rep.content[0].text.trim() : ''
}
