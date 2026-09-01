# ATG « Système 30 Secondes » — Outil de PRODUCTION

## Contexte
Ce projet **n'est plus une démo**. Parti d'une démo générique « Assistant de Visite IONNYX »
(voir `PRD.md`, purement historique), il a été **forké et spécialisé pour Olivier GRAVIOU
(société ATG Ravalement)**, qui a signé le plan PRO. **C'est son outil de production quotidien.**

**Promesse métier** : du chantier au devis, sans rien retaper.
Visite terrain (photos + dictée vocale) → compte-rendu IA (PDF) → Devis Express →
push dans son CRM/logiciel de devis **Costructor**.

- **Production** : `https://atg-systeme-30-secondes.ionnyx.fr` (Vercel, auto-deploy depuis `main`)
- **Repo** : `github.com/julien118/ATG-SYSTEME30SEC` · branche de travail = `main`

> 📖 **Avant toute action non triviale, lis `REPRISE-SYSTEME.md`** — c'est la carte complète et
> à jour du système (routes, moteurs de devis, données, points chauds). Ce `CLAUDE.md` n'est
> qu'un résumé d'orientation. `PRD.md` décrit l'ancienne démo : ne pas s'y fier pour la prod.

## ⚠️ Sécurité production — À LIRE avant de toucher à Costructor
- En **prod Vercel**, l'app **lit ET écrit sur le VRAI compte Costructor d'Olivier**
  (`COSTRUCTOR_API_KEY` = sa clé, `ATG_COSTRUCTOR_CIBLE = olivier`). Ce ne sont pas des données
  de test : ce sont ses vrais devis et ses vrais clients.
- En **dev/local, reste sur le compte TEST** (`ATG_COSTRUCTOR_CIBLE = test`). Le pré-check de la
  suite de fidélité **refuse de tourner** si la clé pointe le compte d'Olivier.
- **Retour arrière = 2 min sans code** : remettre la clé test + `ATG_COSTRUCTOR_CIBLE = test` sur
  Vercel puis redéployer (les gardes sont pilotées par env).
- Ne jamais committer de secret. `.env.local`, `env.txt`, `memory/` et `DECOUVERTE-COMPTE-OLIVIER.md`
  / `REPLICATION-LOG.md` sont gitignorés (structure commerciale réelle d'Olivier + clés).

## Stack
Next.js 14 (App Router) · React 18 · TypeScript strict · Tailwind 3.4 · Supabase (Postgres +
Storage) · Claude (couche IA) · Groq Whisper (transcription FR) · Costructor (CRM/devis).

## Commandes
- `npm run dev` — serveur local (Next 14)
- `npm run build` — build production
- `npm run test:fidelite` — suite de fidélité du clonage ITE (attendu : **32 PASS / 0 FAIL**,
  lecture seule + brouillons sur le compte test, jamais d'écriture chez Olivier)

## Contexte d'exécution (à connaître avant d'éditer)
- **Mode single-user** : auth bypassée, `user_id` en dur via `ATG_USER_ID` (`lib/atg.ts`),
  `middleware.ts` en passthrough, **RLS désactivée** (les filtres `user_id` restent en défense
  côté serveur — les garder). Ce n'est **pas** une app multi-comptes.
- **Modèle Claude centralisé** : `MODELE_CLAUDE` (`lib/anthropic.ts`, défaut `claude-sonnet-4-6`,
  surchargeable via `ANTHROPIC_MODEL`). Point unique importé par toute la couche IA — une
  retraite de modèle = **un seul** changement. Ne pas hardcoder un modèle ailleurs.
- **Supabase** : projet ATG dédié `rgloyviokgmzaevliqmr`. ⚠️ non joignable via le MCP Supabase
  connecté (qui pointe d'autres projets) — DDL/migrations passent par le SQL Editor.
- **Deux moteurs de devis** produisant le même type `SectionDevis[]` : moteur **plat** (ravalement,
  fail-safe) et moteur de **clonage ITE** (fidélité au devis-modèle d'Olivier). Aiguillage dans
  `lib/atg-routing.ts`. Détail dans `REPRISE-SYSTEME.md` §3.
- **Support intégré** : bouton « Demander à Julien » → ticket → Telegram → réponse in-app (+ vocal).
- **Observabilité** : erreurs capturées via Sentry → « Tour de Contrôle » ; heartbeat en fin de
  cron quotidien (`vercel.json` : `/api/cron` à 07:00).

## Règles de travail
- **Mobile-first, toujours** — utilisé sur le terrain, sur smartphone, souvent en 4G.
- **Zéro friction UX** — chaque étape doit être intuitive, guidée naturellement.
- **Prod réelle** : toute action qui écrit chez Costructor engage le vrai compte d'Olivier.
  En cas de doute, rester sur le compte test et demander confirmation avant de basculer.
- Respecter la **whitelist serveur** des articles (Claude ne doit jamais inventer un article de
  bibliothèque) et la garde de cohérence compte↔snapshot (`lib/costructor-compte.ts`).

## Sources de vérité
- `REPRISE-SYSTEME.md` — **carte complète et à jour** du système (à lire en premier)
- `DEVLOG.md` — journal technique chronologique
- `STYLE-OLIVIER.md` — style des devis d'Olivier
- Mémoire projet (`MEMORY.md` + `memory/`) — état détaillé, vivant
- `DECOUVERTE-COMPTE-OLIVIER.md` / `REPLICATION-LOG.md` — compte Costructor réel d'Olivier (gitignorés)

---
*Dernière mise à jour : 2026-09-01. Ce fichier remplace l'ancienne fiche « Version Démo »
(le projet est passé en production pour Olivier GRAVIOU / ATG Ravalement).*
