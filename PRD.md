# PRD — Assistant de Visite IONNYX · Version DÉMONSTRATION

> Document de référence pour Claude Code — Nouveau projet from scratch
> Objectif : construire une version démo générique de l'Assistant de Visite IONNYX, destinée à être testée par n'importe quel artisan/professionnel du bâtiment sans personnalisation préalable.

---

## 1. Vision & objectifs

### Ce qu'est cette démo

Une version allégée et générique de l'Assistant de Visite Terrain IONNYX. Elle permet à n'importe quel professionnel du bâtiment (maçon, plombier, couvreur, électricien, maître d'œuvre, peintre…) de tester l'outil en conditions réelles : capturer des photos et des observations vocales sur un chantier, puis générer automatiquement un rapport de visite structuré via l'IA.

### Objectif business

Permettre à un prospect de comprendre la valeur de l'outil en moins de 30 secondes, puis de le tester lui-même sur un vrai chantier. L'essai est limité à **2 rapports de visite générés**. Au-delà, un écran de fin d'essai redirige vers la prise de contact avec IONNYX.

### Principes de design

1. **Zéro friction** — chaque étape doit être intuitive, aucune explication ne devrait être nécessaire
2. **Guidé intuitivement** — l'utilisateur est accompagné naturellement d'une étape à l'autre
3. **Mobile-first** — l'outil est utilisé sur le terrain, sur smartphone, souvent en 4G
4. **Générique** — aucun vocabulaire, champ ou template spécifique à un corps de métier
5. **Impressionnant rapidement** — le résultat (le rapport) doit provoquer un effet "wow"

### Déploiement cible

- URL : **demo.ionnyx.fr**
- Hébergement : Vercel (auto-deploy GitHub)
- Projet Supabase : **nouveau projet dédié** (séparé de la production Hendrix)

---

## 2. Architecture technique

### Stack (identique au projet principal)

| Couche | Technologie | Rôle |
|--------|------------|------|
| Framework | Next.js 14 (App Router) | SSR, routing, API routes |
| UI | React 18 | Composants interactifs |
| Langage | TypeScript (strict) | Typage |
| CSS | Tailwind CSS 3.4 | Styling utility-first, mobile-first |
| Police | Inter (Google Fonts) | Police principale |
| Auth | Supabase Auth | Magic link email (pas de mot de passe) |
| BDD | Supabase PostgreSQL | Tables avec RLS |
| Storage | Supabase Storage | Buckets `audio` (privé) et `photos` (public) |
| IA rapport | Anthropic Claude | claude-sonnet-4-20250514 · Génération rapport JSON |
| Transcription | Groq Whisper | whisper-large-v3-turbo · Audio → texte français |
| PDF | jsPDF + jspdf-autotable | Génération PDF côté serveur |
| Compression | Canvas API native | Compression JPEG côté client |
| Hébergement | Vercel | Auto-deploy GitHub |

### Patterns architecturaux

- **Server Components** pour l'auth et le fetch de données
- **Client Components** (`'use client'`) pour toute interactivité
- **API Routes** Next.js pour la logique serveur
- **RLS Supabase** pour l'isolation des données par utilisateur
- **Pas de state manager global** — useState/useRef/useCallback suffisent
- **Path alias** `@/*` vers la racine du projet
- **PWA** — manifest pour ajout à l'écran d'accueil (pas de service worker, pas d'offline)

---

## 3. Modèle de données

### 3.1 Table `profiles`

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | UUID | PK, FK → auth.users | Même ID que l'utilisateur auth |
| `prenom` | TEXT | NOT NULL | Prénom de l'utilisateur |
| `nom` | TEXT | NOT NULL | Nom de l'utilisateur |
| `telephone` | TEXT | | Téléphone |
| `metier` | TEXT | | Métier / corps de métier |
| `entreprise` | TEXT | | Nom de l'entreprise (optionnel) |
| `rapports_generes` | INTEGER | DEFAULT 0 | Compteur de rapports générés (max 2) |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | Date d'inscription |

**Trigger :** `handle_new_user()` — crée automatiquement une ligne `profiles` à l'inscription

**RLS :** SELECT/UPDATE restreints à `auth.uid() = id`

### 3.2 Table `chantiers`

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | Identifiant unique |
| `user_id` | UUID | FK → auth.users, NOT NULL, ON DELETE CASCADE | Propriétaire |
| `client_nom` | TEXT | NOT NULL | Nom du client ou du chantier |
| `client_adresse` | TEXT | | Adresse du chantier |
| `client_telephone` | TEXT | | Téléphone client |
| `client_email` | TEXT | | Email client |
| `date_visite` | TIMESTAMPTZ | | Date et heure de la visite |
| `objet_travaux` | TEXT | | Description des travaux |
| `statut` | ENUM | 'planifie' · 'en_cours' · 'termine' · 'rapport_genere' | État du chantier |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | DEFAULT now(), trigger auto-update | |

**Champs supprimés par rapport à la version client :** `client_prenom`, `provenance`, `type_chantier` (direct/sous-traitance)

**Index :** `idx_chantiers_user_id`, `idx_chantiers_date_visite`

**RLS :** SELECT/INSERT/UPDATE/DELETE restreints à `auth.uid() = user_id`

### 3.3 Table `capture_items`

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | UUID | PK | Identifiant unique |
| `chantier_id` | UUID | FK → chantiers, ON DELETE CASCADE | Chantier parent |
| `type` | ENUM | 'vocal' · 'photo' | Type de capture |
| `position` | INTEGER | | Ordre chronologique dans la timeline |
| `audio_url` | TEXT | | URL signée vers le fichier audio |
| `transcription` | TEXT | | Texte transcrit par Whisper |
| `photo_url` | TEXT | | URL publique de la photo |
| `linked_photo_id` | UUID | FK → capture_items, ON DELETE SET NULL | Liaison explicite vocal → photo |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | |

**Index :** `idx_capture_items_chantier_id`, `idx_capture_items_position`, `idx_capture_items_linked_photo`

**RLS :** Accès via ownership du chantier parent

### 3.4 Table `rapports`

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | UUID | PK | |
| `chantier_id` | UUID | FK → chantiers, UNIQUE, ON DELETE CASCADE | Un seul rapport par chantier |
| `contenu_json` | JSONB | | Rapport structuré |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | DEFAULT now(), trigger auto-update | |

**RLS :** Accès via ownership du chantier parent

### 3.5 Storage Supabase

| Bucket | Visibilité | Chemin | Format |
|--------|-----------|--------|--------|
| `photos` | Public | `{userId}/{chantierId}/{timestamp}.jpg` | JPEG compressé |
| `audio` | Privé (signed URLs) | `{userId}/{chantierId}/{timestamp}.webm` | WebM/Opus |

### 3.6 Diagramme des relations

```
auth.users (Supabase Auth)
    │
    ├─── 1:1 ──→ profiles (prenom, nom, metier, rapports_generes)
    │
    └─── 1:N ──→ chantiers
                    │
                    ├─── 1:N ──→ capture_items
                    │               │
                    │               └── linked_photo_id ──→ capture_items (self-ref)
                    │
                    └─── 1:1 ──→ rapports
```

### 3.7 Interfaces TypeScript

```typescript
type ChantierStatut = 'planifie' | 'en_cours' | 'termine' | 'rapport_genere'
type CaptureType = 'vocal' | 'photo'

interface Profile {
  id: string
  prenom: string
  nom: string
  telephone: string | null
  metier: string | null
  entreprise: string | null
  rapports_generes: number
  created_at: string
}

interface Chantier {
  id: string
  user_id: string
  client_nom: string
  client_adresse: string
  client_telephone: string
  client_email: string
  date_visite: string
  objet_travaux: string
  statut: ChantierStatut
  created_at: string
  updated_at: string
}

interface CaptureItem {
  id: string
  chantier_id: string
  type: CaptureType
  position: number
  audio_url: string | null
  transcription: string | null
  photo_url: string | null
  linked_photo_id: string | null
  created_at: string
}

interface RapportObservationPhoto {
  url: string
  legende: string
}

interface RapportObservation {
  titre: string
  description: string
  points_vigilance: string[]
  photos: RapportObservationPhoto[]
}

interface RapportContenu {
  client: {
    nom: string
    adresse: string
    telephone: string
    email: string
    date_visite: string
  }
  observations: RapportObservation[]
  acces_chantier: string
  duree_estimee: string
  notes: string
}
```

---

## 4. Structure des fichiers

```
/
├── app/
│   ├── layout.tsx                    # Layout racine (metadata, fonts, body)
│   ├── page.tsx                      # Landing/redirect selon auth
│   ├── globals.css                   # Tailwind + custom CSS
│   ├── favicon.ico
│   │
│   ├── inscription/
│   │   └── page.tsx                  # Onboarding ultra-simplifié (Client Component)
│   │
│   ├── chantiers/
│   │   ├── page.tsx                  # Liste des chantiers (Server Component)
│   │   ├── chantiers-list.tsx        # Liste interactive (Client Component)
│   │   ├── nouveau/
│   │   │   └── page.tsx              # Création chantier simplifié
│   │   └── [id]/
│   │       ├── page.tsx              # Détail chantier
│   │       ├── visite/
│   │       │   ├── page.tsx          # Page visite (Server Component)
│   │       │   └── visite-client.tsx # Capture terrain (Client Component)
│   │       └── rapport/
│   │           ├── page.tsx          # Page rapport (Server Component)
│   │           └── rapport-client.tsx # Affichage/export rapport (Client Component)
│   │
│   ├── essai-termine/
│   │   └── page.tsx                  # Écran fin d'essai (CTA contact IONNYX)
│   │
│   └── api/
│       ├── auth/
│       │   └── callback/route.ts     # Callback magic link Supabase
│       ├── chantiers/
│       │   └── [id]/route.ts         # DELETE — Suppression chantier + cleanup
│       ├── transcribe/route.ts       # POST — Transcription audio via Groq
│       ├── generate-report/route.ts  # POST — Génération rapport via Claude
│       └── export-pdf/route.ts       # POST — Génération PDF
│
├── components/
│   ├── AddressAutocomplete.tsx       # Autocomplétion adresse (API gouv)
│   ├── AudioRecorder.tsx             # Enregistrement vocal
│   ├── CaptureItem.tsx               # Affichage item timeline
│   ├── ChantierCard.tsx              # Carte chantier dans la liste
│   ├── ChantierForm.tsx              # Formulaire création chantier (simplifié)
│   ├── DeleteChantierModal.tsx       # Modale confirmation suppression
│   ├── PhotoCapture.tsx              # Capture photo (caméra/galerie)
│   ├── ReportView.tsx                # Rendu du rapport avec édition inline
│   ├── StatusBadge.tsx               # Badge statut coloré
│   ├── TrialBanner.tsx               # Bandeau "Il vous reste X rapport(s)"
│   └── UserMenu.tsx                  # Menu utilisateur (déconnexion)
│
├── lib/
│   ├── anthropic.ts                  # Client Anthropic Claude
│   ├── prompts.ts                    # System prompt GÉNÉRIQUE + user prompt builder
│   ├── types.ts                      # Interfaces TypeScript
│   ├── utils.ts                      # Utilitaires (dates, compression image)
│   └── supabase/
│       ├── client.ts                 # Client navigateur
│       ├── server.ts                 # Client serveur
│       └── middleware.ts             # Session refresh + redirections auth
│
├── public/
│   ├── manifest.json                 # PWA manifest
│   ├── icon-192.png                  # Icône PWA
│   ├── icon-512.png                  # Icône PWA
│   └── logo-ionnyx.svg              # Logo IONNYX pour le header
│
├── supabase/
│   └── migrations/
│       └── 001_demo_schema.sql       # Schéma complet : profiles, chantiers, capture_items, rapports + RLS + storage + triggers
│
├── middleware.ts                      # Middleware Next.js → session Supabase
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── CLAUDE.md                         # Mémoire projet inter-sessions
```

---

## 5. Authentification & onboarding

### Principe : zéro friction

Pas de mot de passe. Pas de formulaire long. L'objectif est que le prospect teste l'outil en moins de 60 secondes après avoir cliqué sur le lien.

### Flux d'inscription

1. Le prospect arrive sur `demo.ionnyx.fr`
2. Il voit un écran d'accueil avec le branding IONNYX et un CTA "Tester gratuitement"
3. Il arrive sur `/inscription` — formulaire en une seule étape :
   - **Prénom** (requis)
   - **Nom** (requis)
   - **Email** (requis — pour le magic link)
   - **Téléphone** (optionnel)
   - **Métier** (select avec options prédéfinies — voir liste ci-dessous)
   - **Nom de l'entreprise** (optionnel)
4. Il clique "Recevoir mon accès"
5. Supabase envoie un magic link par email
6. Il clique le lien → connecté → redirigé vers `/chantiers`
7. Le trigger `handle_new_user()` crée le profil avec les infos saisies

### Liste des métiers (select)

```
- Maçonnerie / Gros œuvre
- Couverture / Charpente
- Plomberie / Chauffage
- Électricité
- Peinture / Revêtements
- Menuiserie
- Carrelage / Sols
- Isolation / Façades
- Maître d'œuvre
- Bureau d'études
- Rénovation générale
- Autre
```

### Connexion ultérieure

Si le prospect revient plus tard, il arrive sur la page d'accueil, clique "J'ai déjà un compte", entre son email, reçoit un nouveau magic link. Pas de mot de passe à retenir.

### Routes protégées

Le middleware redirige vers `/inscription` si pas de session. Les API routes vérifient l'auth via `supabase.auth.getUser()`.

**Exception :** la page d'accueil `/` et `/inscription` sont publiques.

---

## 6. Parcours utilisateur complet

### Flux principal

```
Accueil → Inscription (magic link) → Liste chantiers → Créer chantier → Visite terrain → Rapport IA → Export PDF
```

### Détail pas à pas

#### Étape 1 — Accueil (`/`)

Écran simple et impactant :
- Logo IONNYX
- Titre : "Générez vos rapports de visite en 30 secondes"
- Sous-titre : "Prenez des photos, dictez vos observations. L'IA fait le reste."
- CTA principal : "Tester gratuitement" → `/inscription`
- Lien secondaire : "J'ai déjà un compte" → formulaire magic link

#### Étape 2 — Inscription (`/inscription`)

Formulaire unique, voir section 5 ci-dessus.

#### Étape 3 — Liste des chantiers (`/chantiers`)

- Header : logo IONNYX + nom de l'utilisateur + UserMenu
- **TrialBanner** en haut : "Essai gratuit — Il vous reste X rapport(s) sur 2" avec une barre de progression visuelle
- Liste des chantiers de l'utilisateur (vide au départ)
- Si aucun chantier : état vide avec illustration et CTA "Créer ma première visite"
- Bouton flottant vert "Nouvelle visite" en bas à droite
- Onglets de filtre : Tous | En cours | Rapports
- Barre de recherche par nom/adresse/objet
- Suppression par appui long (600ms) → vibration → modale confirmation

#### Étape 4 — Création de chantier (`/chantiers/nouveau`)

**Formulaire simplifié — 4 champs seulement :**

| Champ | Type | Requis | Notes |
|-------|------|--------|-------|
| Nom du client / chantier | text | Oui | Un seul champ, pas prénom+nom séparés |
| Adresse | AddressAutocomplete | Non | API adresse.data.gouv.fr |
| Objet des travaux | textarea | Non | Placeholder : "Ex: Rénovation salle de bain, ouverture mur porteur..." |
| Date de visite | date + heure | Non | Pré-rempli avec la date/heure actuelle |

**Comportement :**
- Auto-save au blur de chaque champ (debounce 1s)
- Un seul bouton d'action principal : **"Démarrer la visite →"** (btn-primary, pleine largeur)
- Ce bouton crée le chantier (si nouveau) + passe le statut à `en_cours` + redirige vers `/chantiers/[id]/visite`

Pas de champs téléphone/email à cette étape. On les ajoutera plus tard si le prospect convertit en client payant.

#### Étape 5 — Visite terrain (`/chantiers/[id]/visite`)

C'est le cœur de l'app. L'interface est divisée en 3 zones fixes :

```
┌─────────────────────────────────┐
│  HEADER FIXE                    │  Nom du chantier, compteurs (X photos, Y vocaux), bouton "Terminer"
├─────────────────────────────────┤
│                                 │
│  TIMELINE SCROLLABLE            │  Items chronologiques (photos, vocaux, groupes liés)
│                                 │
├─────────────────────────────────┤
│  BARRE D'ACTIONS FIXE          │  Bouton photo + Bouton micro (ou mode "Décrire cette photo")
└─────────────────────────────────┘
```

**Flux photo (handlePhotoTaken) :**
1. L'utilisateur prend une photo ou choisit dans sa galerie
2. `compressImage(file)` → Blob JPEG (max 1920px, qualité 0.8)
3. Upload Supabase Storage bucket `photos` avec retry exponentiel (3 tentatives : 1s, 2s, 4s)
4. Récupération URL publique
5. Insert `capture_items` (type='photo', position=next)
6. La photo apparaît dans la timeline
7. Démarrage du countdown 10 secondes — la barre d'actions passe en mode **"Décrire cette photo"**

**Flux audio (handleRecordingComplete) :**
1. Upload Supabase Storage bucket `audio` avec retry exponentiel
2. Création URL signée (validité 365 jours)
3. Insert `capture_items` (type='vocal', position=next)
4. Si mode "describe" actif OU dernière photo < 30s → `linked_photo_id = lastPhotoItem.id`
5. POST `/api/transcribe` avec le blob audio
6. Update `capture_items.transcription` avec le texte retourné
7. Reset du mode describe

**Liaison photo-vocal (shouldLinkToPhoto) :**
- Activée quand : countdown 10s actif OU dernière photo prise il y a moins de 30 secondes
- Stockée via `linked_photo_id` dans `capture_items`
- Un vocal lié sera marqué `[LIÉ À PHOTO #position]` dans le prompt IA

**Groupement d'affichage :**
- Photo + vocal lié = fusionnés dans une seule carte (photo en haut, transcription en dessous)
- Vocaux liés masqués de la liste principale
- Items non liés affichés individuellement

**Actions sur les items :**
- Supprimer : bouton poubelle sur chaque carte (si groupé, supprime les deux)
- Éditer une transcription : clic sur le texte → textarea → blur = sauvegarde

**Auto-scroll :** scroll vers le bas à chaque nouvel item (sauf si l'utilisateur a scrollé vers le haut)

**Fin de visite :**
1. Bouton "Terminer la visite" dans le header
2. Modale récapitulative : "X photos et Y observations capturées. Générer le rapport ?"
3. **Vérification limite :** si `profiles.rapports_generes >= 2` → redirect vers `/essai-termine`
4. Si OK → statut → `termine` → redirect vers `/chantiers/[id]/rapport`

#### Étape 6 — Rapport IA (`/chantiers/[id]/rapport`)

**Génération automatique :** si aucun rapport n'existe pour ce chantier, la génération se lance automatiquement à l'ouverture de la page.

**Barre de progression animée (4 étapes) :**
1. "Analyse des captures..."
2. "Corrélation photos et observations..."
3. "Rédaction du rapport..."
4. "Finalisation..."

**Affichage du rapport :**
- Section infos client : nom, adresse, date
- Observations groupées : titre + description + photos légendées + points de vigilance
- Accès chantier (si renseigné par l'IA)
- Durée estimée
- Notes

**Édition inline :** clic sur une description → textarea → blur = sauvegarde dans le JSONB

**Viewer photo plein écran :** fond noir, zoom pincement + double-tap, pan, bouton X

**Barre d'actions (3 boutons — simplifiée vs version client) :**

| Bouton | Action |
|--------|--------|
| 🔄 Régénérer | Supprime le rapport + relance la génération |
| 👁️ Prévisualiser PDF | POST `/api/export-pdf` → iframe lightbox |
| ⬇️ Télécharger PDF | Depuis la preview → `<a download>` |

**PAS de Google Drive** dans la version démo. Pas de bouton partager non plus (on simplifie au maximum).

**Après génération réussie :**
- Update `chantiers.statut = 'rapport_genere'`
- Incrémenter `profiles.rapports_generes` (+1)

#### Étape 7 — Fin d'essai (`/essai-termine`)

Quand `profiles.rapports_generes >= 2`, l'utilisateur est redirigé ici à chaque tentative de générer un nouveau rapport.

**Contenu de la page :**
- Logo IONNYX
- Titre : "Votre essai est terminé !"
- Sous-titre : "Vous avez généré vos 2 rapports gratuits. Vous avez vu ce que l'outil peut faire — imaginez-le personnalisé pour votre activité."
- **CTA principal** : "Obtenir ma version personnalisée" → lien vers Calendly ou WhatsApp Julien
- **CTA secondaire** : "Revoir mes rapports" → retour vers `/chantiers`
- Bullet points des avantages de la version complète :
  - Interface personnalisée à votre métier
  - Rapports illimités
  - Export Google Drive automatique
  - Template de rapport sur-mesure
  - Support prioritaire

---

## 7. Logique métier clé

### 7.1 Compression d'image côté client

Identique à la version client :
- `compressImage(file)` dans `lib/utils.ts`
- Max 1920px de largeur, qualité JPEG 0.8
- Pas d'upscaling si l'image est plus petite
- Via Canvas API native

### 7.2 Transcription vocale (Groq Whisper)

**Endpoint :** `POST /api/transcribe`

- Reçoit un FormData avec le blob audio WebM/Opus
- Envoie à Groq : modèle `whisper-large-v3-turbo`, langue `fr`, format `json`
- Retourne `{ text: "transcription" }`

### 7.3 Génération de rapport IA (Claude)

**Endpoint :** `POST /api/generate-report`

**IMPORTANT — Vérification de la limite :** Avant de générer, l'API vérifie `profiles.rapports_generes`. Si >= 2, retourne une erreur 403 `{ error: "trial_limit_reached" }`.

#### System prompt GÉNÉRIQUE (lib/prompts.ts)

Le system prompt doit être réécrit pour être générique. Voici le prompt complet à utiliser :

```
Tu es un expert en rédaction de rapports de visite technique pour les professionnels du bâtiment. Tu reçois un flux chronologique mixte (observations vocales transcrites + URLs de photos) capturé pendant une visite de chantier.

TON RÔLE :
1. ANALYSER le flux chronologique pour comprendre ce que le professionnel a observé
2. DÉDUIRE le type de travaux et le corps de métier à partir du contenu (ne jamais demander)
3. CORRÉLER chaque photo à l'observation la plus pertinente
4. PRODUIRE un rapport structuré, professionnel et exploitable

RÈGLES DE CORRÉLATION PHOTO-OBSERVATION :
- "[LIÉ À PHOTO #X]" dans un vocal → liaison EXPLICITE, priorité absolue
- VOCAL puis PHOTO (consécutifs) → la photo illustre le vocal
- PHOTO puis VOCAL (consécutifs) → le vocal décrit la photo
- Plusieurs PHOTOS entre 2 vocaux → rattacher sémantiquement au vocal le plus pertinent
- CHAQUE photo doit apparaître EXACTEMENT UNE FOIS dans le rapport

RÈGLES DE RÉDACTION :
- Légendes de photos : TOUJOURS descriptives et concrètes. JAMAIS "Vue du chantier", "Photo du mur", etc. La légende doit dire CE QU'ON VOIT de spécifique.
- Mesures et dimensions : toujours en **gras markdown** (ex: **5,36 m**, **parpaing de 20**)
- Vocabulaire technique : utiliser le vocabulaire adapté au corps de métier détecté
- Ton : professionnel mais accessible, phrases complètes
- Points de vigilance : identifier les risques, contraintes et précautions pertinentes
- Données client : recopier à l'IDENTIQUE depuis les informations fournies, ne rien inventer

FORMAT DE SORTIE — JSON STRICT :
Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou après, sans backticks markdown.

{
  "client": {
    "nom": "string — recopié tel quel",
    "adresse": "string — recopiée telle quelle",
    "telephone": "string — recopié tel quel",
    "email": "string — recopié tel quel",
    "date_visite": "string — recopiée telle quelle"
  },
  "observations": [
    {
      "titre": "string — titre court et descriptif de la zone/élément observé",
      "description": "string — description détaillée avec mesures en **gras**",
      "points_vigilance": ["string — chaque point de vigilance identifié"],
      "photos": [
        {
          "url": "string — URL exacte de la photo (ne jamais modifier)",
          "legende": "string — légende descriptive et concrète"
        }
      ]
    }
  ],
  "acces_chantier": "string — description de l'accès au chantier si mentionné, sinon chaîne vide",
  "duree_estimee": "string — estimation si mentionnée, sinon chaîne vide",
  "notes": "string — informations complémentaires, sinon chaîne vide"
}
```

#### User prompt (buildUserPrompt)

```
INFORMATIONS CLIENT :
- Nom : {client_nom}
- Adresse : {client_adresse}
- Téléphone : {client_telephone}
- Email : {client_email}
- Date de visite : {date_visite}
- Objet des travaux : {objet_travaux}

FLUX CHRONOLOGIQUE DE LA VISITE :
VOCAL #1 (position 1) : "transcription..."
PHOTO #2 (position 2) : https://...
VOCAL #3 (position 3) [LIÉ À PHOTO #2] : "transcription..."
...

Génère le rapport structuré en JSON. Réponds UNIQUEMENT avec le JSON, sans commentaire.
```

#### Appel API Anthropic

```
POST https://api.anthropic.com/v1/messages
model: claude-sonnet-4-20250514
max_tokens: 4096
```

#### Parsing de la réponse

1. Extraire `response.content[0].text`
2. Regex `/\{[\s\S]*\}/` pour extraire le JSON
3. `JSON.parse()` → `RapportContenu`

#### Audit des photos post-génération

Après génération, vérifier que TOUTES les photos envoyées apparaissent dans le rapport :
1. Collecter les `photo_url` des capture_items
2. Collecter les `photos[].url` des observations du rapport
3. Comparer
4. Photos manquantes → ajouter une observation "Photos supplémentaires"

#### Sauvegarde

- Upsert dans `rapports`
- Update `chantiers.statut = 'rapport_genere'`
- Incrémenter `profiles.rapports_generes`

### 7.4 Export PDF

**Endpoint :** `POST /api/export-pdf`

Identique à la version client. Structure du PDF :

```
┌──────────────────────────────────────┐
│  ██████████████████████████████████  │  Header noir (32mm)
│  RAPPORT DE VISITE                   │  Titre blanc 18pt
│  {Nom client} — {Date}              │  Sous-titre 10pt
├──────────────────────────────────────┤
│  INFORMATIONS CLIENT                 │  Heading vert 12pt
│  Nom : ...                           │
│  Adresse : ...                       │
│  ─────────────────────────────────  │  Séparateur
│  OBSERVATION 1 — {titre}             │  Heading vert 11pt
│  Description...                      │
│  [PHOTO]                             │  Photo centrée (85% largeur)
│  Légende                             │  Italique 8pt
│  ┌── Points de vigilance ────────┐  │  Encadré vert
│  │  • ...                        │  │
│  └───────────────────────────────┘  │
│  ...                                 │
├──────────────────────────────────────┤
│  Rapport généré par IONNYX — IA      │  Footer 7pt gris centré
└──────────────────────────────────────┘
```

Dimensions : A4 (210×297mm), marges 18mm, photos max 85% largeur.

Nom du fichier : `rapport-visite-{nom}-{YYYY-MM-DD}.pdf`

### 7.5 Machine à états du chantier

```
planifie ──→ en_cours ──→ termine ──→ rapport_genere
```

| Transition | Déclencheur |
|-----------|------------|
| planifie → en_cours | Clic "Démarrer la visite" |
| en_cours → termine | Clic "Terminer" dans la visite |
| termine → rapport_genere | Génération du rapport réussie |
| rapport_genere → rapport_genere | Régénération (upsert, pas de nouvel incrément compteur) |

---

## 8. Limite d'essai — Mécanique complète

### Règle

L'utilisateur peut générer **2 rapports de visite maximum**. Le compteur est `profiles.rapports_generes`.

### Points de contrôle

1. **API `/api/generate-report`** : vérifie `rapports_generes < 2` avant de lancer la génération. Si >= 2, retourne 403.
2. **Page rapport (côté client)** : si erreur 403 `trial_limit_reached`, redirect vers `/essai-termine`.
3. **Bouton "Terminer la visite"** : avant de rediriger vers le rapport, vérifie le compteur. Si >= 2, redirect vers `/essai-termine`.
4. **TrialBanner** : affiché sur `/chantiers` avec le compteur visuel.

### Incrémentation

Le compteur est incrémenté **uniquement** lors d'une première génération réussie pour un chantier donné. La régénération d'un rapport existant ne ré-incrémente PAS le compteur.

### Ce que l'utilisateur peut toujours faire après la limite

- Voir ses chantiers existants
- Voir ses rapports déjà générés
- Télécharger les PDF déjà générés
- Il ne peut PAS créer de nouveau rapport

---

## 9. Design system

### Palette de couleurs

| Rôle | Code |
|------|------|
| Primary (CTA) | `#10B981` → `#059669` (gradient émeraude) |
| Header/Dark | `#1A1A1A` |
| Background | `#F8FAFC` |
| Foreground | `#111827` |
| Border | `#E5E7EB` |
| Input bg | `#F9FAFB` |
| Input focus | `#ECFDF5` |
| Focus ring | `rgba(16, 185, 129, 0.15)` |

### Badges de statut

| Statut | Couleur | Icône |
|--------|---------|-------|
| En cours | amber-50 / amber-700 | 🔨 |
| Terminé | gray-100 / gray-600 | ✓ |
| Rapport | emerald-50 / emerald-700 | 📄 |

### Classes CSS custom

```css
.btn-primary    → gradient émeraude, ombre verte, scale 0.97 au clic
.btn-secondary  → fond noir, texte blanc
.btn-tertiary   → fond blanc, bordure grise, bordure émeraude au hover
.input-ionnyx   → fond gris clair, bordure émeraude au focus, halo vert
```

### Animations

| Classe | Usage |
|--------|-------|
| `animate-slide-up` | Modales bottom-sheet (0.3s) |
| `animate-scale-in` | Modales desktop (0.28s) |
| `animate-fade-in` | Toasts (0.2s) |
| `animate-card-appear` | Cartes feed (0.25s) |
| `pulse-record` | Bouton enregistrement actif (continu) |

### Typographie

- Police : Inter (Google Fonts) + fallback système
- Inputs : 16px minimum (anti-zoom iOS)
- Rendu : `-webkit-font-smoothing: antialiased`

### Optimisations mobile

- Safe area insets pour les encoches
- Vibration haptic sur appui long
- Compression image côté client
- Bottom sheets pour menus contextuels
- Inputs 16px (anti-zoom iOS)

---

## 10. Composants spécifiques à la démo

### TrialBanner

Bandeau affiché en haut de la page `/chantiers`.

```
┌─────────────────────────────────────────────────┐
│  🎯 Essai gratuit — 1 rapport restant sur 2     │
│  ████████████░░░░░░░░░░░░ (50%)                 │
└─────────────────────────────────────────────────┘
```

- Si `rapports_generes === 0` : "2 rapports disponibles" + barre vide
- Si `rapports_generes === 1` : "1 rapport restant" + barre 50%
- Si `rapports_generes === 2` : "Essai terminé" + barre pleine + lien vers `/essai-termine`

### Page fin d'essai (`/essai-termine`)

Voir section 6, étape 7.

Le CTA principal pointe vers un lien de prise de rendez-vous (Calendly ou lien WhatsApp). Ce lien sera configuré via une variable d'environnement `NEXT_PUBLIC_CONTACT_URL` pour pouvoir le changer facilement.

---

## 11. Variables d'environnement

| Variable | Côté | Usage |
|----------|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Serveur | URL du projet Supabase démo |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + Serveur | Clé publique Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Serveur uniquement | Clé admin Supabase |
| `ANTHROPIC_API_KEY` | Serveur uniquement | Clé API Anthropic |
| `GROQ_API_KEY` | Serveur uniquement | Clé API Groq |
| `NEXT_PUBLIC_CONTACT_URL` | Client | URL de prise de contact (Calendly/WhatsApp) |

---

## 12. Règles métier critiques

### Données

1. **Un utilisateur ne voit que ses propres chantiers** — RLS sur toutes les tables
2. **Un seul rapport par chantier** — contrainte UNIQUE sur `rapports.chantier_id`
3. **Suppression en cascade** — supprimer un chantier supprime ses capture_items, son rapport, ET ses fichiers storage
4. **Profil auto-créé** — trigger PostgreSQL à l'inscription

### Capture terrain

5. **Compression obligatoire** — toute photo compressée à max 1920px / JPEG 80%
6. **Upload avec retry** — 3 tentatives avec backoff exponentiel (1s, 2s, 4s)
7. **Audio en signed URL** — bucket privé, URLs signées 1 an
8. **Photos en URL publique** — bucket public (nécessaire pour l'analyse IA)
9. **Fenêtre de liaison photo-vocal** — 30 secondes depuis la photo OU countdown actif

### Rapport IA

10. **Aucune photo perdue** — audit post-génération
11. **Liaisons explicites prioritaires** — `[LIÉ À PHOTO #X]` prime sur la proximité
12. **Mesures en gras** — `**...**` markdown
13. **Données client inchangées** — recopiées à l'identique
14. **Légendes spécifiques** — jamais de légende générique
15. **JSON strict** — Claude répond uniquement en JSON

### Limite d'essai

16. **2 rapports maximum** — compteur dans `profiles.rapports_generes`
17. **Vérification côté serveur** — l'API refuse la génération si limite atteinte
18. **Régénération gratuite** — ne compte pas comme un nouveau rapport
19. **Accès lecture conservé** — les rapports existants restent accessibles après la limite

### Export

20. **PDF généré côté serveur** — dans l'API route
21. **Images inline dans le PDF** — fetch + base64
22. **Branding IONNYX** — footer "Rapport généré par IONNYX — IA" sur chaque page

---

## 13. Ce qui n'est PAS dans la démo

Pour être explicite, voici les features de la version client qui sont **volontairement exclues** :

- ❌ Google Drive (OAuth, upload, dossier auto)
- ❌ Bouton partager (Web Share API)
- ❌ Champs `provenance` et `type_chantier` (direct/sous-traitance)
- ❌ Champs `client_prenom` séparé (un seul champ `client_nom`)
- ❌ Inscription manuelle dans Supabase (remplacée par magic link)
- ❌ Onglets "Planifiés" et "Finis" séparés (simplification des onglets)
- ❌ Prompt IA spécifique à un métier (prompt générique auto-adaptatif)
- ❌ Chantier démo pré-rempli (retiré pour simplifier le MVP — à ajouter dans une V2 si nécessaire)

---

*Fin du PRD — Prêt pour implémentation via Claude Code.*
