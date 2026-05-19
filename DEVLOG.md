# DEVLOG — Système 30 Secondes ATG

Journal technique du travail réalisé sur la branche `feat/devis-express-atg`,
forkée du repo `ionnyx-demo` pour la démo R2 Olivier GRAVIOU (ATG).

---

## 2026-05-17 — Phase 1 : Personnalisation ATG du clone ionnyx-demo

**Pourquoi** : adapter une instance dédiée ATG sans casser le code de production ionnyx-demo. Olivier doit avoir l'impression que l'outil est SON outil, pas un démo générique.

### Bypass auth (mode single-user)
- Nouvelle constante `ATG_USER_ID = '00000000-0000-0000-0000-0000000000a7'` dans `lib/atg.ts` + fallback `ATG_PROFIL`
- `middleware.ts` réduit à un passthrough `NextResponse.next()`
- Tous les Server Components et Route Handlers : remplacement de `supabase.auth.getUser()` par `ATG_USER_ID` constante
- Suppression complète : `app/home-client.tsx`, `app/inscription/`, `app/api/auth/`, `components/UserMenu.tsx`, `lib/supabase/middleware.ts`
- Migration SQL adaptée : RLS désactivée sur `profiles`, `chantiers`, `capture_items`, `rapports` + drop des policies auth-based + retrait des FK vers `auth.users`

### Branding ATG
- Logo officiel téléchargé depuis atg-ravalement.com et cropped (sans numéro de téléphone) via PIL Python
- `components/LogoLink.tsx` réécrit : utilise `/public/logo-atg.png` 128×38, hauteur affichage 44px, lien interne `/chantiers`
- `app/layout.tsx` : title "ATG — Système 30 Secondes", metadata adaptés, robots noindex (démo privée)
- `public/manifest.json` : name "ATG — Système 30 Secondes", short_name "ATG", start_url `/chantiers`
- Slogan "Du chantier au devis, sans rien retaper." ajouté sous le header dashboard
- Footer "Propulsé par IONNYX"

### Suppressions visuelles
- Bandeau "Version de démo. Ce n'est pas un logiciel..." retiré de `layout.tsx`
- `TrialBanner` import + usage retirés de `chantiers-list.tsx`
- Logique `isTrialOver` + bouton sticky "Échanger avec Julien" retirés
- Redirects vers `/essai-termine` retirés (`rapport-client.tsx`, `visite-client.tsx`)
- Suppression fichiers : `app/essai-termine/`, `components/TrialBanner.tsx`

### Textes ravalement
- Placeholder du champ "Objet des travaux" : "Ex: Ravalement complet façade, ITE, peinture extérieure, traitement fissures..."

---

## 2026-05-18 — Phase 2 : Module Devis Express

**Pourquoi** : ajouter la chaîne CR → devis Costructor enrichi. C'est LE différenciateur Olivier ("Je vends de la technique, pas un prix").

### Schéma DB
- Drop ancien `devis` (résidu from-scratch avec FK vers `visites`)
- Recréation `devis` avec FK vers `chantiers(id)` + colonnes `sections_proposees JSONB`, `sections_finales JSONB`, `costructor_devis_id`, `costructor_devis_url`, `total_ht`, `total_ttc`
- RLS désactivée
- Trigger `devis_modifie_le` créé puis SUPPRIMÉ (pointait vers `updated_at` inexistant)
- Table `bibliotheque_costructor` conservée (déjà seedée avec 11 articles côté Supabase ATG)

### Libs IA + SDK Costructor
- `lib/atg.ts` : constantes
- `lib/supabase/admin.ts` : `createAdminClient()` service_role pour bypass RLS
- `lib/costructor.ts` : SDK fetch Bearer, `creerContactParticulier`, `creerProduit`, `listerProduits`, `pousserDevis`, `supprimerDevis`. IDs unités hardcodés (UNIT_M2, UNIT_ML). `construirePayloadDevis` qui formatte `<strong>libellé</strong><br><br>desc` en HTML aéré.
- `lib/quote-proposer.ts` : prompt enrichi avec verbatims Olivier ("Je vends de la technique, pas un prix", "Mes devis font 4 pages", "dossier d'appel d'offres"). Structure 3 paragraphes obligatoire : Diagnostic / Mise en œuvre / Finition. Modèle `claude-sonnet-4-20250514`.
- `lib/metrics-parser.ts` : parse vocal des métrés vers updates JSON, matching tolérant.
- `lib/types.ts` étendu : `ArticleBibliotheque`, `Devis`, `SectionDevis`, `ArticleDevis` avec `description_technique`, types Costructor.

### Routes API
- `POST /api/devis/proposer` : lit obs vocales + biblio, Claude génère structure + descriptions, whitelist serveur, upsert devis
- `POST /api/devis/metres-vocaux` : 2 modes (audio Whisper+parse OU JSON sections save sans audio)
- `POST /api/devis/pousser` : IDEMPOTENT — supprime ancien Costructor quote si déjà poussé avant POST

### Pages
- `app/chantiers/[id]/rapport/rapport-client.tsx` : bandeau "Préparer mon devis" + handler `handlePrepareDevis` + overlay animation 5 étapes (~30s)
- `app/chantiers/[id]/devis/page.tsx` (Server) + `devis-editeur.tsx` (Client) : 2 phases
  - Phase A : Proposition technique, édition inline des descriptions (textarea + Annuler/Enregistrer)
  - Phase B : Saisie métrés vocaux + total live
- `app/chantiers/[id]/devis/recap/page.tsx` : tableau style Costructor (couleurs IONNYX), colonnes DÉSIGNATION/QTÉ/UNITÉ/PRIX U/TOTAL, descriptions techniques sous chaque ligne
- `recap/bouton-pousser.tsx` : Client Component, animation 5 étapes Costructor

### Force dynamic
- Toutes les pages `app/chantiers/[id]/devis/...` ont `export const dynamic = 'force-dynamic'` + `revalidate = 0` pour éviter le cache Server Component Next 14.

### Test E2E réussi
Chantier "Résidence Charles Daquin" (`f0ff75dc-b2f6-4034-95b3-d6c417c84456`) :
- 4 sections : Façade Sud / Nord / Pignon Est / Éléments généraux
- 12 articles, descriptions 232-823 caractères
- Push Costructor en 1s → `quote_01krx68xe5c3kx5pev2cfvrpmr` (devis témoin pour plan B)
- Total 4 655 € HT, 5 120,50 € TTC

---

## Pièges techniques résolus (à ne pas re-vivre)

1. **RLS active malgré DISABLE** → SQL purge des policies + ALTER TABLE DISABLE
2. **Trigger `updated_at`** sur table `devis` qui n'a que `modifie_le` → DROP TRIGGER
3. **Cache Server Component Next 14** affichant vieille version après push → `force-dynamic`
4. **Bibliothèque Costructor invisible via anon** → bascule routes API sur `createAdminClient()`
5. **Sauts de ligne `\n\n` strippés par Costructor** → format HTML `<strong>libellé</strong><br><br>desc`
6. **Doublons brouillons Costructor à chaque push** → idempotence via `supprimerDevis()` avant POST
7. **Logo ATG officiel avec numéro de téléphone** → crop top 38px + fond transparent via PIL
8. **Validator hook signale Next 16** sur projet Next 14 → faux positifs ignorés

---

## État au 2026-05-19

- Tout marche en E2E local sur `http://localhost:3001`
- Devis Costructor témoin en place pour plan B
- Mémoire utilisateur sauvegardée dans `~/.claude/projects/-Users-julienguedet-Documents-Github-D-MONSTRATION-ATG/memory/`

## Si on relance le projet plus tard

1. `npm install` puis `npm run dev` sur port 3001
2. Variables d'env critiques dans `.env.local` : Supabase + Anthropic + Groq + COSTRUCTOR_API_KEY + COSTRUCTOR_DEMO_CUSTOMER_ID
3. Vérifier que le bucket Supabase Storage `photos` est public et `audio` privé
4. Vérifier que RLS reste `false` sur les 4 tables ATG + `devis`
5. Si quelque chose plante côté DB : vérifier que ce n'est pas la RLS qui s'est réactivée

## Si on veut industrialiser (post-démo)

- Réactiver auth Supabase magic link + remplacer `ATG_USER_ID` par `auth.uid()`
- Repasser routes API sur `createServerClient()` cookies-based
- Activer la RLS avec vraies policies par `user_id`
- Multi-tenant : table `companies` + `company_id` partout
- Déploiement Vercel prod + URL personnalisée
- Régler le souci TVA "non applicable art. 293 B" côté compte Costructor d'Olivier (passage SARL au lieu de franchise base)
