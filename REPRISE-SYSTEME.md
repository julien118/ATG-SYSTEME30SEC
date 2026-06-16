# REPRISE — État du système ATG « Système 30 Secondes »

> Document de reprise consolidé (2026-06-16). Photo complète du système au moment où Julien
> reprend la main. À lire avec `DEVLOG.md` (journal technique), `STYLE-OLIVIER.md` (style des
> devis d'Olivier) et la mémoire projet (`~/.claude/projects/.../memory/`, index `MEMORY.md`).
> **Aucun secret ni donnée client réelle ici** (sûr à committer). Les clés vivent dans
> `.env.local` (gitignoré) ; la structure commerciale d'Olivier dans `DECOUVERTE-COMPTE-OLIVIER.md`
> et `REPLICATION-LOG.md` (gitignorés).

---

## 1. Ce qu'est le système aujourd'hui

À l'origine, une **démo générique** « Assistant de Visite IONNYX » (le `PRD.md`). Le projet a
été **forké et spécialisé pour Olivier GRAVIOU (ATG Ravalement)**, qui a **signé le plan PRO**.
Ce n'est plus une démo : c'est **son outil de production**.

**Promesse métier** : du chantier au devis, sans rien retaper.
**Visite terrain (photos + dictée vocale) → compte-rendu IA (PDF) → Devis Express → push dans
son CRM/logiciel de devis Costructor.**

**Stack & contexte d'exécution**
- Next.js 14 (App Router) + TypeScript strict + Tailwind, mobile-first.
- **Supabase** projet ATG dédié `rgloyviokgmzaevliqmr` (Postgres + Storage). ⚠️ pas joignable
  via le MCP Supabase connecté (qui pointe d'autres projets) — DDL/migrations passent par le
  canal SQL Editor habituel.
- **Claude** pour toute la couche IA. Modèle centralisé : `MODELE_CLAUDE = 'claude-sonnet-4-6'`
  dans [lib/anthropic.ts](lib/anthropic.ts) — **point unique** importé par ~11 fichiers (une
  retraite de modèle = 1 seul changement). *(Incident 2026-06-15 : l'ancien `claude-sonnet-4-20250514`
  a été retiré par Anthropic, faisant tomber toute la couche IA — corrigé par cette centralisation.)*
- **Groq Whisper** (`whisper-large-v3-turbo`) pour la transcription FR.
- **Mode single-user** : auth bypassée (`ATG_USER_ID` dans [lib/atg.ts](lib/atg.ts)),
  `middleware.ts` en passthrough, **RLS désactivée** sur les tables (filtres `user_id` gardés
  côté serveur en défense). Branche d'origine `feat/devis-express-atg`, aujourd'hui sur `main`.
- Hébergement **Vercel**, domaine custom **atg-systeme-30-secondes.ionnyx.fr**.

---

## 2. Le parcours utilisateur (et les routes)

```
/chantiers ──▶ /chantiers/[id] (écran contact) ──▶ /chantiers/[id]/visite
   (dashboard)         (pivot)                         (photos + dictée)
        │                                                     │
        ▼                                                     ▼
  /chantiers/[id]/devis/recap ◀── /chantiers/[id]/devis ◀── /chantiers/[id]/rapport
   (tableau + push Costructor)     (A: technique / B: métrés)   (CR IA + PDF + « Préparer mon devis »)
```

- Dashboard 3 onglets (Tous / Visite technique / Devis), statut **dérivé** (jamais écrit en dur)
  via [lib/statut-affaire.ts](lib/statut-affaire.ts) depuis l'existence rapport + devis.
- Visite : `PhotoCapture` (compression client) + `AudioRecorder`, liaison photo↔vocal (fenêtre 30 s
  ou mode « décrire »), timeline auto-scroll.
- Rapport : génération auto (Claude), audit photo (aucune photo perdue), régénération avec
  consignes voix/écrit, export PDF persisté (bucket `rapports`, URL stable via `/r/[chantierId]`).
- Devis 2 phases dans [devis-editeur.tsx](app/chantiers/[id]/devis/devis-editeur.tsx) : **A** proposition
  technique (renommer/ajouter/supprimer sections, éditer descriptions, remplacer article par
  autocomplétion bibliothèque) ; **B** métrés (saisie manuelle + dictée vocale, auto-save débouncé).
- Récap : tableau style Costructor, `BlocTotaux` (TVA), `BoutonPousser` (mode remplacer / créer une copie).

**API routes** ([app/api/](app/api/)) : `transcribe`, `generate-report`, `devis/proposer`,
`devis/metres-vocaux`, `devis/pousser`, `devis/tva`, `devis/articles`, `assistant-devis`,
`chantiers/[id]` (DELETE + nettoyage storage), `export-pdf/[chantierId]/[fichier]`, et `/r/[chantierId]`
(lien court 302 → PDF, gravé dans le devis Costructor).

---

## 3. Les deux moteurs de devis (le cœur différenciant)

Les deux produisent le **même type** `SectionDevis[]` (récap d'Olivier identique), l'aiguillage
est transparent. `selectionnerModele` ([lib/atg-routing.ts](lib/atg-routing.ts)) tranche la famille.

### Moteur PLAT (ravalement) — chemin historique
- [lib/quote-proposer.ts](lib/quote-proposer.ts) : prompt Claude qui sélectionne les articles de la
  **bibliothèque** et rédige des descriptions **courtes, style Olivier** (100–150 car., ancrées par
  façade, marques/normes réelles), avec **whitelist serveur** (Claude ne peut jamais inventer un article).
- [lib/atg-devis-structure.ts](lib/atg-devis-structure.ts) : `STRUCTURE_DEVIS_ATG` — en-tête
  QUALIFICATIONS + sections transversales (déplacement, échafaudage, lavage, traitement) captées par
  mots-clés. Point unique pour ajuster libellés/ordre.
- `construirePayloadDevis` ([lib/costructor.ts](lib/costructor.ts)) assemble le HTML **en groupes par
  section** (correctif e917d4c : compte d'Olivier assujetti → renderer exige des groupes).

### Moteur de CLONAGE ITE — fidélité au vrai modèle d'Olivier
- [lib/atg-devis-modele.ts](lib/atg-devis-modele.ts) : clone fidèlement le **devis-modèle ITE**
  d'Olivier (`model:true`, lu via `_expand=lines`). Snapshot **figé** à la dérivation, **reconstruction
  au push** (`reconstruireDepuisSnapshot`) : groupes + sous-titres + ordre du modèle, **TVA recopiée
  ligne par ligne** (le modèle a une TVA mixte : poste isolation à 5,5 %, le reste à 10 % — un taux
  unique serait faux), forfaits fixes pré-remplis (éco-contribution / déplacement / déchets).
- **Approche A** : la version validée par Olivier à l'écran **fait foi** (ses renommages / ajouts /
  suppressions sont respectés) ; le modèle ne sert qu'à la fidélité (textes, ordre, prix, TVA). Lien
  récap↔ligne-modèle par `ref_modele` (préfixée + repère d'occurrence `#0/#1` pour un poste répété).
- **Aiguillage** : ITE franc (`margeFamille >= 2`) + modèle ITE trouvé → clonage ; tout le reste
  (ravalement, ambigu, confiance basse) → plat. Le plat est le **fail-safe** (try/catch).
- **Compte-aware** : [lib/costructor-compte.ts](lib/costructor-compte.ts) `compteCibleCostructor()`
  (`ATG_COSTRUCTOR_CIBLE`, défaut `test`) + garde de cohérence `assertSnapshotCoherentAvecCible`
  (interdit « ids d'un compte + écriture sur l'autre »).

**État** : chantier de code **terminé (commits 95fe719 → e571df6)**. Suite de fidélité reproductible
`scripts/fidelite-clonage/` → `npm run test:fidelite` = **32 PASS** (lecture seule + brouillons compte
test, jamais d'écriture chez Olivier).

---

## 4. Intégration Costructor

[lib/costructor.ts](lib/costructor.ts) : SDK Bearer. Contact `trouverOuCreerContact` (matching
email > téléphone > nom, sinon création ; reliage seulement si **signal fort ET noms concordants**),
push **idempotent** (`supprimerDevis` avant POST, sauf mode « créer une copie »), `stripHtml` décode
les entités, `uniteVersCostructorId`.

**Quirks API** (détail dans la mémoire `reference_costructor_api_quirks`) : méta-params en
`_underscore` (`_expand`, `_limit`…) ; `/quotes` plafonné à 10 sans `_limit` ; filtres `/contacts`
ignorés (filtrer côté app) ; `DELETE /contacts` → 405 (suppression manuelle dans l'UI) ;
`DELETE /products` refusé si produit utilisé ; vue `lines` imbriquée redondante (ne pas récurser) ;
le numéro `D-2026-…` n'est attribué qu'au passage en `open` (on pousse des **brouillons** exprès).

---

## 5. Assistant conversationnel

[lib/assistant/](lib/assistant/) — bot flottant **lecture seule**, **anti-hallucination** (chaîne
3-temps : Claude analyse → le **code** calcule → Claude rédige, jamais de chiffre inventé).
**Aiguilleur** → domaines **devis** (multi-critères : client / montant / typologie / période),
**comptes-rendus**, **clients** (fusion Costructor + table `chantiers`), **récap client** (« tout sur X »).
Mémoire de conversation (questions de suivi « et son adresse ? » sans répéter le nom), tolérance aux
fautes ([lib/assistant/matching-nom.ts](lib/assistant/matching-nom.ts), mutualisé avec le parseur de métrés),
candidats cliquables pour les homonymes. API [app/api/assistant-devis/route.ts](app/api/assistant-devis/route.ts).

---

## 6. Données

Migrations [supabase/migrations/](supabase/migrations/) `001` → `005` (la `005` = moteur clonage :
colonnes `moteur` / `modele_id` / `modele_snapshot`). Tables : `profiles`, `chantiers`,
`capture_items`, `rapports` (+ `pdf_url`), **`devis`** (`sections_proposees` / `sections_finales`
JSONB, `costructor_devis_id`/`url`, `total_ht`/`ttc`, `moteur`…), **`bibliotheque_costructor`**.
Buckets Storage : `photos` (public), `audio` (privé, signed URLs 1 an), `rapports` (PDF, public).

⚠️ Dette connue : doublons dans `bibliotheque_costructor` ; migrations Phase 1/2 appliquées
out-of-band (à consolider) ; RLS de la table `devis` en prod contournée par client admin côté serveur.

---

## 7. État de la bascule production

- **Phase I techniquement effectuée le 2026-06-11** : Vercel **Production écrit sur le VRAI compte
  Costructor d'Olivier** (`COSTRUCTOR_API_KEY` = sa clé, `ATG_COSTRUCTOR_CIBLE = olivier`). L'app lit
  son vrai modèle ITE **et** y écrit. ⚠️ **Plus en lecture seule sur Olivier.**
- **Retour arrière = 2 min, sans code** : remettre la clé test + `ATG_COSTRUCTOR_CIBLE = test` sur
  Vercel + redéployer (les gardes sont env-pilotées).
- En dev/local, bien rester sur le **compte test** (le pré-check de la suite de fidélité refuse de
  tourner si la clé = clé Olivier).

---

## 8. ⚠️ Points chauds ouverts (au 2026-06-16)

1. 🔴 **Bug d'affichage Costructor (PRIORITAIRE)** — mémoire `project_atg_affichage_devis_groupes`.
   Les devis poussés par API s'affichent à la 1re ouverture mais **ne se rechargent plus** après un
   cycle ouvrir→fermer→rouvrir (« erreur interne ») : l'éditeur Costructor **re-sauvegarde et corrompt**.
   Touche **tous** nos devis (plat ET clonage) ; les devis natifs de leur UI ne plantent pas. Pistes
   internes épuisées (ligne vide, `#`, parentId, structure…). **Prêt pour demain** : message au support
   Costructor (ids + timestamps prêts) + contournements à tester (test sans ouvrir l'éditeur ; poser
   `source`/`persist`/`sellPriceDecimal` comme l'UI ; `status:open` en dernier recours).
2. **e2e « TEST BASCULE » prod** non encore fait : visite ITE fictive → push → vérifier dans le vrai
   Costructor d'Olivier (structure fidèle, TVA ligne par ligne, prix système ITE à jour 136,33 €/m²,
   TTC sur compte assujetti). À faire avec Julien + Lotfi, puis nettoyer (contact « TEST BASCULE » à la main).
3. **Étape 2 — pré-fil des métrés** (mémoire `project_atg_prefil_metres`) : étape 1 livrée (37f6c7b,
   matcher dictée unité-aware mur-global vs poste-précis) ; **étape 2 à coder** = pré-remplir les
   quantités **dès la génération** depuis la dictée de visite.
4. Dettes : doublons bibliothèque, consolidation migrations, `listerContacts()` non paginé en masse
   (OK sur compte test, à optimiser sur la vraie base d'Olivier).

---

## 9. Démarrer / vérifier

```bash
npm install
npm run dev               # serveur local (Next 14)
npm run build             # build prod
npm run test:fidelite     # suite de fidélité clonage ITE — attendu : 32 PASS / 0 FAIL
```

`.env.local` requis : Supabase (URL + anon + service_role), `ANTHROPIC_API_KEY`, `GROQ_API_KEY`,
`COSTRUCTOR_API_KEY` (+ `_OLIVIER`), `ATG_COSTRUCTOR_CIBLE`, `NEXT_PUBLIC_SITE_URL`.
⚠️ En prod Vercel, `NEXT_PUBLIC_SITE_URL` doit valoir `https://atg-systeme-30-secondes.ionnyx.fr`
(sinon les liens du compte rendu gravés dans les devis cassent).

**Sources de vérité** : ce document (carte) · `DEVLOG.md` (journal) · `STYLE-OLIVIER.md` (style devis) ·
mémoire projet `MEMORY.md` (état détaillé, vivant) · `DECOUVERTE-COMPTE-OLIVIER.md` /
`REPLICATION-LOG.md` (compte Costructor d'Olivier, gitignorés).
