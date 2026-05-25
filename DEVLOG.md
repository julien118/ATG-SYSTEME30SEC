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

## 2026-05-21 — Reprise dev sur main (3 améliorations)

Reprise sur `main` (Phase 1 + Phase 2 mergées entre temps). 3 améliorations livrées en série, validées une à une.

### Amélioration 1 — Téléphone + email dans le formulaire visite
- `components/ChantierForm.tsx` : 2 nouveaux champs `client_telephone` (tel) + `client_email` (email), auto-save sur blur, persistés en INSERT/UPDATE, pré-remplis en édition.
- **Pas de migration SQL** : les colonnes existaient déjà depuis `001_demo_schema.sql:67-68`, le formulaire ne les exposait juste pas. Confirmé via SELECT direct sur Supabase ATG.
- Bénéfice gratuit : `lib/prompts.ts:62-63` consomme déjà ces champs → rapport IA enrichi sans changer le prompt.

### Amélioration 2 — Matching / création contact Costructor (fin du contact démo hardcodé)
- `lib/costructor.ts` : nouveaux `listerContacts()` + `trouverOuCreerContact()`. Suppression de `creerContactParticulier` (jamais appelée).
- Matching : `email` exact (case-insensitive) > `téléphone` 9 derniers chiffres (gère "06 12..." vs "+33 6 12...") > `nom` exact après normalisation accents/casse. Fragilité du nom signalée en commentaire.
- Création contact : `firstName=""` accepté par Costructor (fullName = lastName), `addresses:[{address:{postal_code...}, primary:true}]` (format pluriel + snake_case validé par POST de test), parse adresse FR best-effort via regex `^(.+?)\s+(\d{5})\s+(.+)$`.
- `app/api/devis/pousser/route.ts` : `COSTRUCTOR_DEMO_CUSTOMER_ID` remplacé par `trouverOuCreerContact(chantier)`. Log du `matchType`.
- Tests : `scripts/test-contact-matching.mts` (4 scénarios, 4/4) + push E2E réel sur "Mr et Mme Martin" → contact créé `cnt_01ks5yn5cer1rhm2dcrcpz2erv`, quote `quote_01ks5yn5ne7g8njd8bjhad7rk9`, total intact, ancien quote 404 (idempotence OK).

### Amélioration 3 — Structure ATG du devis (config centralisée)
- Nouveau `lib/atg-devis-structure.ts` — **point d'entrée unique** pour ajuster libellés / ordre / mots-clés après kickoff Olivier. `STRUCTURE_DEVIS_ATG = { entete, sectionsTransversales[] }`.
- `construirePayloadDevis` refactoré : émet 1) en-tête QUALIFICATIONS ATG en HTML (`<strong>` + puces `<br>`), 2) sections transversales (`POSTE DÉPLACEMENT`, `ÉCHAFAUDAGE`, `LAVAGE`, `TRAITEMENT`) avec articles captés par mots-clés (normalisation lowercase + diacritiques + substring match), 3) façades restantes.
- Section façade vide après extraction : **non émise** (évite les titres orphelins). Section transversale vide : **émise** (matérialise la structure pour ajout manuel côté Costructor).
- Test : `scripts/test-devis-structure-atg.mts` — scénario M. et Mme Dupont 3 façades reproduit en mémoire, total HT calculé **4 917 €** / TTC **5 408,70 €**, 9/9 assertions (math + ordre + captage).

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
9. **Filtres `/contacts?email=`, `?phone=`, `?search=` ignorés par Costructor** → lister tout + filtrer côté Next.js
10. **`DELETE /contacts/{id}` → 405** → impossible de nettoyer un contact via l'API externe, seule l'UI Costructor le permet
11. **Format adresse contact Costructor** : `addresses:[{address:{street,city,postal_code,country}, primary:true}]` (pluriel + `postal_code` snake_case) — `address:{zip}` est silencieusement ignoré

---

## État au 2026-05-21

- Tout marche en E2E local
- Formulaire visite : nom + adresse + téléphone + email + objet travaux + date
- Push devis : matching contact réel (email > téléphone > nom > création), plus de contact démo hardcodé
- Structure ATG du devis centralisée dans `lib/atg-devis-structure.ts`
- Scripts de test : `scripts/test-contact-matching.mts` + `scripts/test-devis-structure-atg.mts`
- `COSTRUCTOR_DEMO_CUSTOMER_ID` n'est plus utilisé par le code (laissé dans `.env.local` mais inutile)

## Si on relance le projet plus tard

1. `npm install` puis `npm run dev` sur port 3001
2. Variables d'env critiques dans `.env.local` : Supabase + Anthropic + Groq + COSTRUCTOR_API_KEY (COSTRUCTOR_DEMO_CUSTOMER_ID plus utilisée depuis l'amélioration 2)
3. Vérifier que le bucket Supabase Storage `photos` est public et `audio` privé
4. Vérifier que RLS reste `false` sur les 4 tables ATG + `devis`
5. Si quelque chose plante côté DB : vérifier que ce n'est pas la RLS qui s'est réactivée
6. Pour rejouer les scripts de test : `npx tsx --env-file=.env.local scripts/test-contact-matching.mts` (ou `test-devis-structure-atg.mts`)

## Si on veut industrialiser (post-démo)

- Réactiver auth Supabase magic link + remplacer `ATG_USER_ID` par `auth.uid()`
- Repasser routes API sur `createServerClient()` cookies-based
- Activer la RLS avec vraies policies par `user_id`
- Multi-tenant : table `companies` + `company_id` partout
- Déploiement Vercel prod + URL personnalisée
- Régler le souci TVA "non applicable art. 293 B" côté compte Costructor d'Olivier (passage SARL au lieu de franchise base)

## Points en attente avant kickoff / bascule sur le compte d'Olivier

1. **Consolider les migrations SQL manquantes.** Tous les changements Phase 1 (RLS désactivée, FK auth.users droppées, single-user) + Phase 2 (tables `devis` + `bibliotheque_costructor`, seed 11 articles, colonnes JSONB) ont été appliqués out-of-band sur Supabase ATG. Rien n'est dans `supabase/migrations/`. À regrouper dans un `002_atg_consolidation.sql` (ou plusieurs) avant la bascule pour que le compte d'Olivier soit reproductible depuis zéro.
2. **Valider la structure devis ATG au kickoff** avec les vrais devis d'Olivier sous les yeux. Trois questions ouvertes :
   - Préserver les sections façade même quand leurs articles sont aspirés par les transversales ? (Olivier parle d'organisation "façade par façade" en R2 — peut contredire le comportement actuel où une façade vidée disparaît.)
   - Toggle pour masquer les sections transversales vides (POSTE DÉPLACEMENT, ÉCHAFAUDAGE quand aucun article ne s'y trouve) ?
   - Ajuster les `motsCles` après avoir vu les libellés réels qu'il utilise.
   - Tout se passe dans `lib/atg-devis-structure.ts`, c'est conçu pour.
3. **Optimiser `listerContacts()`.** Charge tous les contacts à chaque push (les filtres serveur Costructor sont ignorés, cf. piège #9). OK sur le démo (5 contacts), problématique sur le compte d'Olivier (potentiellement des centaines de clients). Pistes : pagination + cache local Supabase + index sur les colonnes de matching. À traiter avant la bascule sinon les push deviendront lents et le risque de doublon augmente avec la taille de la base.
4. **Nettoyer les doublons dans `bibliotheque_costructor`.** Audit du 2026-05-25 : sur les 21 lignes, 7 libellés sont en doublon avec deux `costructor_article_id` distincts chacun (Échafaudage façade -8m, Imperméabilité I3, Imperméabilité I4, Installation et repli, Peinture décorative 2 couches, Protections et bâchage, Ravalement minéral). Trace probable de deux imports successifs. Le UNIQUE sur `costructor_article_id` n'empêche pas ces doublons-là (IDs différents). Conséquence : le matching libellé → article dans `lib/quote-proposer.ts` est ambigu, le premier article rencontré gagne. À nettoyer avant la bascule en gardant l'ID Costructor effectivement présent dans la bibliothèque d'Olivier (à vérifier au kickoff — probablement les IDs `prod_01krjzeb…` qui correspondent au compte d'Olivier, pas `prod_01krjxnz…`).
