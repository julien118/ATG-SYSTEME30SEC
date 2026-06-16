# Audit de sécurité — Système de connexion ATG « Système 30 Secondes »

> Audit du 2026-06-16. Porte d'accès single-user (mot de passe unique + cookie signé HMAC).
> Méthode : tests fonctionnels réels + audit adversarial multi-agents sur 6 dimensions, chaque
> faille moyenne/élevée **réfutée par un second analyste** au regard du contexte réel (app
> mono-utilisateur, HTTPS Vercel, UUID non devinables). Aucun secret dans ce document.

## Verdict global

**Aucune faille CRITIQUE ni ÉLEVÉE confirmée.** Les fondations sont saines (vérifiées) :
HMAC-SHA256 correct, comparaison du mot de passe en **temps constant**, **fail-closed**, cookie
`HttpOnly + SameSite=Lax + Secure(prod)`, pas de XSS, CSRF bloqué par SameSite, pas de
contournement du middleware, UUID de rapport non énumérables, secrets côté serveur uniquement
(jamais `NEXT_PUBLIC`, jamais loggés, `.env.local` gitignoré).

Ce qui reste = **du durcissement défense-en-profondeur** + **un vrai point de réponse à incident**
à corriger (changer le mot de passe ne coupe pas les sessions). Rien n'est exploitable à distance
en l'état.

---

## 1. Tests fonctionnels (réalisés, tous concluants)

| Test | Résultat |
|------|----------|
| Accès sans cookie → pages | **307** vers `/login?next=…` ✓ |
| Accès sans cookie → API protégées | **401** ✓ |
| Routes publiques (`/login`, `/r/<id>`, `/api/export-pdf`) | non gatées (200/404, pas de redirect login) ✓ |
| Mauvais mot de passe | **401** ✓ |
| Bon mot de passe | **200** + cookie `HttpOnly, SameSite=Lax, Max-Age 30j`, `Secure` en prod ✓ |
| Cookie falsifié (1 caractère) | **rejeté** (307 login) ✓ |
| Déconnexion | cookie effacé → 307 ✓ |
| Throttle (échecs répétés) | **429** à la 11ᵉ tentative ✓ |
| Typecheck `tsc` / build prod | verts ✓ |

---

## 2. Failles & faiblesses (après vérification adversariale)

Sévérité = **après** réfaction au contexte (origine → ajustée). « Réel ? » = exploitable en pratique
ici, ou simple durcissement.

### 🟠 MOYENNE — à traiter

| # | Faille | Réel ? | Essence |
|---|--------|--------|---------|
| **SESSION-2** | Changer `APP_ACCESS_PASSWORD` ne révoque **aucune** session existante | **Oui** | Le cookie ne dépend que de `SESSION_SECRET`. Si le mot de passe fuit et qu'Olivier le change (réflexe), un intrus déjà connecté garde l'accès jusqu'à 30 j. Le **seul** vrai « kill switch » est de faire tourner `SESSION_SECRET` sur Vercel + redéployer — contre-intuitif et non documenté. |
| **BRUTE-1 / DEPLOY-2** | Throttle anti-bruteforce **inefficace en serverless** | Oui | Le compteur est une `Map` en mémoire d'une instance Lambda ; Vercel répartit les requêtes sur N instances → le plafond « 10/15 min » ne tient pas à l'échelle. Le vrai rempart reste l'entropie du mot de passe (forte aujourd'hui) + le délai 400 ms. |

### 🟡 FAIBLE — durcissement recommandé

| # | Faille | Essence |
|---|--------|---------|
| CRYPTO-1 / SESSION-1/3 | Session **non révocable** + durée **30 j** fixe, logout cosmétique (efface le cookie côté client seulement) | Borné car single-user, mais amplifie toute fuite de cookie. |
| DEPLOY-1 / HEADERS-1 | **Aucun en-tête de sécurité** (pas de HSTS, X-Frame-Options, CSP frame-ancestors, nosniff, Referrer-Policy) | Clickjacking non exploitable en pratique (actions à confirmation), mais filet anti-downgrade/iframe manquant. |
| ACCES-1 | PDF client servi **sans `Cache-Control`** | Une réponse PII pourrait être mise en cache par un proxy. (Accès public = design assumé, OK.) |
| BRUTE-2 | Clé de throttle dérivée de `X-Forwarded-For[0]` (falsifiable) | Contournement / DoS de lockout théoriques ; barrière déjà faible (cf. BRUTE-1). |
| REDIR-1 | Paramètre `?next=` validé **côté client uniquement** | Pas d'open-redirect serveur aujourd'hui ; durcir la regex + valider côté serveur. |
| CRYPTO-2 / DEPLOY-4 | Pas de garde sur la **force/présence** de `SESSION_SECRET` au démarrage | Secret actuel fort (256 bits), mais un secret manquant/faible passerait en silence et donnerait un « mot de passe incorrect » trompeur. |

### ✅ Faux positifs / sain (vérifié)

CSRF-1 (bloqué par `SameSite=Lax`), XSS (rendu React échappé, pas de `dangerouslySetInnerHTML`),
contournement middleware (aucun, fail-closed sur casse/slash/encodage), `safeEqual` (opère sur des
digests de longueur fixe → pas de fuite), widget assistant (n'appelle que des API gatées),
exposition des secrets (aucune), force brute des UUID (122 bits, infaisable).

---

## 3. Plan de remédiation priorisé (sécurité)

**Quick wins (effort faible, à faire en priorité) :**
1. **Documenter + outiller la révocation** (SESSION-2/CRYPTO-1). Idéal : dériver la clé de signature du mot de passe courant — `clé = HMAC(SESSION_SECRET, APP_ACCESS_PASSWORD)` — pour que **changer le mot de passe invalide automatiquement toutes les sessions**. (Alternative : un `SESSION_EPOCH` incrémentable.) À défaut immédiat : documenter « changer le mot de passe ⇒ rotater aussi `SESSION_SECRET` ».
2. **En-têtes de sécurité** dans `next.config.mjs` (`headers()`) : `Strict-Transport-Security`, `X-Frame-Options: DENY` (+ CSP `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy`.
3. **`Cache-Control: private, no-store`** sur la route PDF (`app/api/export-pdf/...`).
4. **Garde de configuration au démarrage** : refuser de servir si `SESSION_SECRET`/`APP_ACCESS_PASSWORD` absents ou trop courts ; erreur serveur distincte du « 401 mot de passe ».
5. **Durcir la validation de `?next=`** côté serveur (regex chemin interne strict, rejet des `\`, `//`, caractères de contrôle).

**Moyen terme :**
6. Réduire la session **30 j → 7 j** et/ou ajouter une rotation glissante + révocation par epoch.
7. **Rate-limit partagé** (Vercel KV / Upstash, `INCR`+`EXPIRE`) avec plafond **global** ; dériver l'IP d'une source fiable (pas `XFF[0]`).
8. Vérification d'`Origin`/`Sec-Fetch-Site` sur les routes mutantes (ou `SameSite=Strict`).

**Pré-requis prod (déjà partiellement en place) :**
- `APP_ACCESS_PASSWORD` **fort et aléatoire** (≥ 16 car.) + `SESSION_SECRET` 256 bits, **définis sur Vercel (Production)** avant la bascule. ⚠️ Le `.env.local` contient aujourd'hui un mot de passe **temporaire** (`valeur temporaire de dev (remplacée)`) — à remplacer par un secret fort, à la fois en local et sur Vercel.

---

## 4. Améliorations UX / design pour Olivier (artisan, mobile, peu technophile)

**Priorité haute (impact élevé, effort faible) :**
1. **Œil afficher/masquer le mot de passe** — saisie au doigt vérifiable (bouton `type=button`, `aria-label`). Aucune concession de sécurité.
2. **Champ identifiant masqué** (`autocomplete="username"`, ex. « Olivier ») devant le champ mot de passe → les gestionnaires (iCloud/Google/Bitwarden) **enregistrent et reproposent** la connexion → Olivier ne retape **plus jamais** rien.
3. **« Mot de passe oublié ? »** → pas d'email possible : afficher un lien de **contact IONNYX** (`tel:`/`mailto:`), honnête, jamais le mot de passe.
4. **Messages d'erreur plus humains** + effacés dès qu'il remodifie le champ ; conseils doux (majuscules, espace en trop) sans aider un attaquant.
5. **Confort clavier mobile** : `enterKeyHint="go"`, `autoCapitalize="none"`, `autoCorrect="off"`, `spellCheck=false` (évite les échecs « fantômes »).

**Priorité moyenne :**
6. **Case « Rester connecté sur cet appareil »** (cochée par défaut sur son tel) → 30 j ; décochée → session courte (appareil prêté). `signSession` accepte déjà une durée paramétrable.
7. **PWA 1 tap** : bouton « Installer sur mon téléphone » (Android `beforeinstallprompt`, iOS mini-aide « Partager → écran d'accueil ») + `apple-touch-icon` 180×180 + icône `maskable` + métas `apple-mobile-web-app` → vraie appli plein écran à la marque ATG.
8. **Design `/login`** : bandeau noir #1a1a1a plus généreux, logo ATG centré, signature « par IONNYX » (vrai logo `public/logo-ionnyx.svg`), titre « Connexion », carte plus aérée.
9. **`theme-color` cohérent** au lancement PWA (noir ATG) + status bar.

**Accessibilité :**
10. Contrastes « par IONNYX » / « Accès réservé » (gray-400/500 → gray-600 min, WCAG AA), focus visible sur le bouton, et **réautoriser le zoom** (le layout force `userScalable:false` ; les inputs étant déjà à 16 px, on peut le retirer sans réintroduire le zoom-jump iOS).
11. **Layout clavier-safe** : garder champ + bouton visibles quand le clavier s'ouvre (ancrer plus haut, autoriser le scroll).

---

## 5. Conclusion

La porte d'accès est **solide pour son usage** (un seul utilisateur, données propres, pas de
multi-tenant) : la cryptographie et le contrôle d'accès sont corrects, et les scénarios d'attaque
les plus inquiétants tombent face au contexte réel. Les actions à plus forte valeur sont :
**(1)** rendre la révocation réelle et documentée (changer le mot de passe doit couper l'accès),
**(2)** ajouter les en-têtes de sécurité, **(3)** remplacer le mot de passe temporaire par un secret
fort sur Vercel. Côté Olivier, l'**œil + l'autofill gestionnaire + « rester connecté »** suppriment
quasiment toute friction de connexion.

---

## 6. Correctifs appliqués (2026-06-16)

**2ᵉ secret :** la connexion exige désormais **email + mot de passe** (`verifyEmail`, temps constant,
saisie normalisée ; toute combinaison incorrecte → 401). Testé.

**Quick wins sécurité — faits & vérifiés :**
- **Révocation réelle** : le cookie embarque une empreinte HMAC des identifiants (`{exp, c}`) → changer
  `APP_ACCESS_PASSWORD` ou `APP_ACCESS_EMAIL` invalide **toutes** les sessions immédiatement. Testé
  (ancien cookie → 307, ancien mot de passe → 401, nouveau → 200). Couvre SESSION-1/2, CRYPTO-1.
- **En-têtes de sécurité** (`next.config.mjs` `headers()`) : HSTS, `X-Frame-Options: SAMEORIGIN`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, CSP `frame-ancestors 'self'`. Vérifiés en réponse.
- **`Cache-Control: private, no-store`** sur la route PDF (ACCES-1).
- **Garde de configuration** au signin : secrets absents/courts → **500 distinct** (pas un 401 trompeur),
  nom de la variable loggé sans sa valeur (CRYPTO-2/DEPLOY-4).
- **Validation `?next=` durcie** (chemin interne strict, anti open-redirect ; REDIR-1).

**Quick wins UX — faits :** œil **Afficher/Masquer** le mot de passe ; champ email = **identifiant
autofill** (gestionnaires de mots de passe) ; lien **« Mot de passe oublié ? » → contact IONNYX** ;
messages d'erreur effacés à la saisie + message 500 dédié ; **hints clavier** mobile
(`enterKeyHint`, `autoCapitalize/Correct/spellCheck off`).

**Restent (effort moyen, non bloquants) :** « Rester connecté » optionnel, PWA installable +
icônes iOS, polish design avancé de `/login`, réautoriser le zoom (accessibilité), rate-limit
partagé (Vercel KV/Upstash). **Action prod :** définir `APP_ACCESS_EMAIL` + `APP_ACCESS_PASSWORD`
(fort) + `SESSION_SECRET` sur Vercel, et remplacer le mot de passe **temporaire** local
`valeur temporaire de dev (remplacée)`.
