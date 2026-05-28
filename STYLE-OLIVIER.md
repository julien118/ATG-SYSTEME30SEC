# Style des devis de ravalement d'Olivier (ATG)

Synthese extraite de 10 vrais devis de ravalement / ITE du compte Costructor d'ATG
(sur 614 devis, 425 identifies ravalement, 276 distincts apres dedoublonnage).
Donnees aspirees en lecture seule via `_expand=lines` le 2026-05-28.
Echantillon : 194 lignes produit, 10 devis de 2023 a 2026, de 3 300 a 32 000 euros.
Fichiers sources : `data/devis-olivier/*.json`, recap dans `_index.json`.

> But : recalibrer la generation d'articles de la PWA et re-seeder la bibliotheque
> de demo de Julien pour qu'elle ressemble aux vrais devis d'Olivier.

---

## 0. L'ecart le plus important a corriger (lire en premier)

Le style reel d'Olivier est **l'oppose** des devis actuellement generes par la PWA
dans le compte de demo de Julien.

| Critere | Devis demo actuels (genere IA) | Vrais devis d'Olivier |
|---|---|---|
| Longueur description | ~1 500 caracteres, 4 a 5 paragraphes | **mediane 106 caracteres**, 1 bloc (max 643) |
| Ton | Dissertation technique generique | Phrase courte, concrete, orientee mise en oeuvre |
| Produits | "systeme I3 taloche" generique | **Marques et references precises** (Baumit StarSystem, Virtuotech, PSE TH31 R=4.50 ACERMI N°...) |
| Normes | Citees en abondance et delayees | Citees court, en sigle (DTU 42.1, NF EN 1062-1, classe 7b2-10c) |
| Intitule | Long, redige | Court, type bon de commande ("Lavage facade moyenne ou haute pression") |

**Action :** raccourcir radicalement les descriptions generees, injecter de vraies
marques/references produit, et structurer en postes courts. Voir sections 3 et 5.

---

## 1. Structure type d'un devis

Un devis d'Olivier n'est PAS une simple liste facade par facade. C'est un assemblage
de quatre familles de lignes :

1. **En-tete administratif et qualite** (lignes texte, recurrentes mot pour mot) :
   - `ATG est certifiee Qualibat attribution 6111 Peinture et Ravalement de facade` (present sur 8/10 devis)
   - Mentions legales de fin : `Tous travaux non compris dans ce devis feront l'objet d'un avenant...` et `L'offre de l'entreprise, constituee par le devis et le cas echeant...`
   - Si sous-traitance : `AUTOLIQUIDATION DE LA TVA, TRAVAUX DE SOUS-TRAITANCE`
   - Parfois date de visite : `VISITE INITIALE DU 06/03/2023`, `Date de visite initiale : 11/10/2024`

2. **Postes transversaux de chantier** (toujours presents, en general en tete) :
   - Deplacement / installation / repli
   - Echafaudage (amene, montage Comabi, repli)
   - Lavage haute pression
   - Traitement algicide / fongicide
   - Gestion des dechets (benne DIB)
   Ces postes sont parfois regroupes sous un titre `Elevation, lavage, traitement :` (4/10).

3. **Sections facade par facade** (titres texte = noms reels du bati) :
   `Facade Sud`, `Facade Nord`, `Pignon Ouest`, `Pignon Est`, `Facade garage (non isolee)`,
   `Facade maison`, `Facade cote rue (partie chauffee)`, `Partie chauffee` / `Partie non chauffee`,
   `Facade sous veranda`, `Facade Ouest fissures importantes`. Chaque section contient ses
   propres lignes (ravalement ou ITE + appuis + soubassement).

4. **Sections de details et points singuliers** (recurrents) :
   `Tableaux et voussures`, `Corniche beton` (et `Corniche beton et bandeau`),
   `Traitement des dessous de toits`, `Souche(s) de cheminee(s)`, `Descente eaux pluviales`,
   `Soubassement, descente escalier et sous sol`, `Portail et cloture Est/Ouest`.

5. **Notes "NB" et reserves** (lignes texte, ton direct au client) :
   - `NB : prevoir depose, repose PAC` (4/10)
   - `NB : Prevoir taillage arbres pour acces`
   - `NB : pose des nouveaux volets a charge client`
   - `modification gouttieres, a charge couvreur` (delimitation de responsabilite, tres frequent)
   - `Deplacement de la PAC a charge client`

**Ordre observe** : en-tete qualite, puis postes transversaux (souvent sous "Elevation,
lavage, traitement"), puis une section par facade avec ses lignes, puis details (corniches,
dessous de toit, souches, descentes EP), entrecoupes de NB et de mentions de responsabilite,
et mentions legales en fin.

---

## 2. Intitules d'articles recurrents (mot pour mot)

Repris verbatim depuis `product.name` / description. Le nombre entre crochets est le nombre
d'occurrences dans l'echantillon.

### Postes transversaux
- `[9x]` **Deplacement, installation du chantier, mise en place materiel d'elevation, nettoyage de fin de chantier, repli** (unite `u`, forfait)
- `[8x]` **Amene du materiel, montage echafaudage Comabi R200 Progress (conforme aux normes de montage en securite), repli du materiel** (parfois `compris supplement elevation toiture`) (unite `m²`)
- `[9x]` **Lavage facade moyenne ou haute pression** (unite `m²`)
- `[9x]` **Traitement algicide, fongicide, issu de la chimie raisonnee** (unite `m²`)
- `[3x]` **Gestion des dechets : depot dans notre benne DIB, situee 22 route de l'Aurore 37130 Mazieres de Touraine, prestataire ETS Passenaud (compris traitement)** (unite `m³`)

### Ravalement (finitions)
- `[10x]` **Ravalement I3 peinture HB Classification NF T 36-005 Famille I - classe 7b2-10c NF T 34-722 et DTU 42.1 : I1 a I4 selon systeme NF EN 1062-1 : E4a5V2W3A1a5 : apres preparation du support, traitement des fissures a l'enduit fibre : - application 1 couche de Virtuotech Fixateur opacifiant 200g/m2 - application 1 couche de Virtuotech Inter 300g/m2 - application 1 couche de Virtuotech lisse 400g/m2** (unite `m²`)
- `[6x]` **Facade : apres preparation du support, traitement des fissures, fourniture et mise en oeuvre systeme de ravalement d'etancheite type I4 avec entoilage** (+ application fixateur, marouflage voile non tisse 5088, finition taloche applitech, plinthe D2) (unite `m²`)
- `[4x]` **Ravalement I4 finition Talochee HB Classification NF T 36-005...** (variante I4 avec marouflage toile antifissure, finition Virtuotech taloche grains fins 1.4kg/m2, plinthe D2) (unite `m²`)
- `[4x]` **Systeme de ravalement d'impermeabilisation I3 10/10e epaisseur du systeme > 0.4mm selon classement norme NF P 84-403** (applitech, plinthe D2) (unite `m²`)
- `[8x]` **Mur interieur : apres preparation du support, fourniture et mise en oeuvre systeme de ravalement d'etancheite type I3 taloche conforme norme NF P 84403 et NF EN1062-1** (unite `m²`)

### ITE (isolation thermique par l'exterieur)
- `[18x]` **Fourniture et mise en oeuvre systeme d'Isolation Thermique Exterieur Systeme BAUMIT STARSYSTEM : cale, cheville, compris rails de depart, accessoires de renforts d'angles, mousse de remplissage, arrets lateraux et hauts, armature generale** + `Recouvrement par systeme de la marque BAUMIT (regulateur, mortier colle, armature, mortier colle, finition talochee type BAUMIT SILIKONTOP (enduit au siloxane)` (unite `m²`)
- `[2x]` **Fourniture et mise en oeuvre systeme d'Isolation Thermique Exterieur de la marque Weber, type Webertherm, cale, cheville... isolant Knauf THERM ITEX TH38 SE epaisseur 60 mm R=1.55, finition organique aspect taloche OU EQUIVALENT** (unite `m²`)
- `[7x]` **Baumit ProTherm PSE BLANC epaisseur 140 mm R= 3.70, ACERMI 12/081/793** (unite `m²`)
- `[7x]` **PSE GRIS TH31 EPAIS. 140MM R=4.50 ACERMI N°17/201/1197 edition 6** (unite `m²`)
- `[4x]` **PSE BAUMIT PROTHERM 1200X600X140 GRIS R=4.50 m2.K/W CERTIFICAT ACERMI N° 12/081/795 - Fabricant : HIRSCH type Cellomur Extra** (unite `m²`)
- `[8x]` **Isolation soubassement : fourniture et mise en oeuvre collee sur soubassements panneaux de Polystyrene type PS 30 SE 120MM, compris colle type Flexyl, enduit de base + treillis d'armature, finition peinture microporeuse Virtuolite 2 couches** (unite `ml`)

### Appuis, points singuliers, finitions
- `[10x]` **Decoupe des appuis de fenetres (compris mise a la benne des gravats) raccords polystyrene, pose appui de fenetre isolant** (unite `ml`)
- `[11x]` **mise en peinture des appuis de fenetres, apres preparation du support, application 2 couches Sigmasol** (unite `ml`)
- `[8x]` **Appui MSEA 1100MM PROF 390MM** (unite `u`)
- `[8x]` **Corniches : preparation du support, application 2 couches de peinture decorative (D2)** (unite `ml`)
- `[4x]` **Dessous de toit (angle) grattage des parties mal adherentes, nettoyage, poncage, essuyage, application 2 couches de laque** (unite `ml`)
- `[2x]` **Tete de chevron : grattage, poncage, application 3 couches de laque** (unite `u`)
- `[3x]` **Souche de cheminee : fourniture et mise en place materiel d'elevation, preparation du support, application 2 couches de peinture decorative (D2) teinte facade** (unite `u`, forfait)
- `[12x]` **Fourniture et pose de fixation pour descente EP, arret de volet, goulotte, charge legere...** (unite `u`)
- `[2x]` **Descente d'eau pluviale, apres preparation, application 2 couches de finition teinte facade** (unite `ml`)
- `[2x]` **Portail + poteaux : poncage, epoussetage, application 2 couches Sigmaneofer** (unite `ml`)
- Lignes "report" (raccordements) : `Report electrique EDF (comprends creation de la demande et paiement intervention ENEDIS)`, `Report 1 eclairage, compris produits`, `Securisation, modification ligne electrique ENEDIS`.

---

## 3. Style et longueur des descriptions

- **Longueur : mediane 106 caracteres, max observe 643.** La grande majorite tient en
  1 a 4 lignes. Pas de paragraphes multiples delayes.
- **Format HTML : enchainement de balises `<div>...</div>`** (une `<div>` par sous-etape),
  parfois `<strong>` pour mettre en avant une caracteristique technique (`<strong>R=4.50 m2.K/W</strong>`),
  et `<span style="color:...">` pour `offert` (vert) ou un point d'attention (bleu).
- **Structure interne quand il y a plusieurs etapes** : liste a tirets dans des `<div>`
  successifs, ex :
  ```
  - application 1 couche de fixateur incolore/opacifiant
  - marouflage du voile non tisse 5088 entre 2 couches d'applitech sous-couche (400g/m2/couche)
  - finition taloche systeme d'impermeabilisation applitech taloche 1.5KG/M2
  ```
- **Vocabulaire metier caracteristique** :
  - Verbes d'attaque : `Fourniture et mise en oeuvre`, `Fourniture et pose`, `apres preparation du support`, `traitement des fissures a l'enduit fibre`.
  - Inclusions : `compris ...` (`compris rails de depart`, `compris traitement`, `compris fournitures, 2 couches`).
  - Garde-fou commercial : `OU EQUIVALENT` / `ou equivalent` apres une reference de marque.
  - Marques citees : **Baumit** (StarSystem, ProTherm, Silikontop), **Weber** (Webertherm),
    **Knauf** (Therm ITEX), **Virtuotech / Virtuolite**, **Applitech**, **Sigmasol / Sigmaneofer**,
    **Comabi** (R200 Progress, echafaudage), **Hirsch** (Cellomur), **Sto**, **Neper Rust**.
  - References normatives courtes : `DTU 42.1`, `NF P 84-403`, `NF EN 1062-1`, `NF T 36-005`,
    `classe 7b2-10c`, `ACERMI N°...`, valeurs `R=3.70` / `R=4.50 m2.K/W`, grammages `400g/m2`, `1.4kg/m2`.
  - Finitions codees : `taloche`, `D2` (peinture decorative), `I3` / `I4` (classes d'impermeabilisation),
    `teinte facade`, `plinthe anti remontee capillaire`.

---

## 4. Fourchettes de prix (min / mediane / max observes)

Tous les prix sont des prix de vente unitaires HT. Source : `sellPrice` (en centimes dans l'API).

| Poste | Unite | Fourchette euros/unite |
|---|---|---|
| Lavage facade haute pression | m² | 3,2 / 3,8 / 3,8 |
| Traitement algicide fongicide | m² | 3,6 / 3,8 / 4,2 |
| Echafaudage (montage Comabi) | m² | 7,8 / 8,2 / 10,4 |
| Facade : protection + nettoyage C9 | m² | 12,8 |
| PSE isolant 140mm (ProTherm blanc R3.70) | m² | 17,3 / 21,7 / 21,7 |
| PSE isolant 140mm (TH31 / Baumit gris R4.50) | m² | 21,6 / 21,6 / 22,5 |
| Ravalement I3 peinture (Virtuotech) | m² | 33,1 |
| Ravalement I3 finition peinture | m² | 46,0 |
| Mur interieur ravalement I3 taloche | m² | 48,8 / 58,8 / 58,8 |
| Ravalement impermeabilisation I3 10/10e | m² | 49,9 |
| Ravalement I4 taloche / entoilage | m² | 59,4 / 59,8 / 59,8 |
| ITE complet (Baumit StarSystem) | m² | 138,5 / 149,8 / 159,8 |
| ITE complet (Weber Webertherm) | m² | 168,0 |
| Corniches 2 couches D2 | ml | 19,3 |
| Mise en peinture appuis (Sigmasol) | ml | 34,1 / 34,1 / 35,7 |
| Dessous de toit (laque) | ml | 38,5 / 38,5 / 46,8 |
| Descente eau pluviale (2 couches) | ml | 12,8 |
| Isolation soubassement (PS 30 collee) | ml | 128 / 138 / 138 |
| Decoupe + pose appuis isolants | ml | 105,5 / 105,5 / 198 |
| Portail + poteaux (Sigmaneofer) | ml | 92,0 |
| Fixation descente EP / arret volet | u | 15,9 |
| Tete de chevron (3 couches laque) | u | 23,0 |
| Report electrique EDF/ENEDIS | u | 32,0 |
| Report eclairage | u | 42 / 45 / 45 |
| Appui MSEA 1100mm | u | 149,3 / 149,3 / 152,3 |
| Souche de cheminee (forfait) | u | 189 / 189 / 289 |
| Deplacement / installation / repli (forfait) | u | 249 / 549 / 689 |

Reperes de devis complets : ravalement courant 9 000 a 20 000 euros, ITE complet
20 000 a 32 000 euros. Surfaces facades typiques 70 a 230 m².

---

## 5. Patterns pour generer automatiquement un devis dans son style

1. **Toujours ouvrir par l'en-tete qualite** : ligne texte `ATG est certifiee Qualibat
   attribution 6111 Peinture et Ravalement de facade`.
2. **Toujours inclure le bloc transversal** (forfait deplacement + echafaudage au m² +
   lavage au m² + traitement au m²), idealement sous un titre `Elevation, lavage, traitement :`.
3. **Une section texte par facade reelle** (nom du bati : Facade Sud, Pignon Ouest...),
   puis ses lignes : ravalement OU ITE, + appuis (decoupe + MSEA + peinture), + soubassement.
4. **Descriptions courtes** (cible 80 a 150 caracteres), format `<div>` par etape, verbe
   d'attaque `Fourniture et mise en oeuvre` / `apres preparation du support`.
5. **Injecter de vraies references produit** selon le type :
   - Ravalement peinture -> Virtuotech (I3), gamme NF T 36-005 / DTU 42.1.
   - Ravalement etancheite -> Applitech, voile 5088, finition taloche, plinthe D2.
   - ITE -> Baumit StarSystem + isolant PSE 140mm R=4.50 ACERMI + finition Silikontop, ajouter `OU EQUIVALENT`.
6. **Ajouter les details singuliers** quand pertinent : corniches (ml), dessous de toit (ml),
   souche de cheminee (forfait), descente EP (ml), tableaux et voussures.
7. **Ajouter des lignes "NB" et de responsabilite** en texte : `modification gouttieres,
   a charge couvreur`, `NB : prevoir depose, repose PAC`, `NB : pose des volets a charge client`.
8. **Cloturer par les mentions legales** : `Tous travaux non compris... avenant` et
   `L'offre de l'entreprise...`.
9. **Unites** : surfaces de facade en `m²`, lineaires (appuis, corniches, dessous de toit,
   soubassement, descentes) en `ml`, points (appuis MSEA, souches, reports, fixations) en `u`,
   dechets en `m³`, forfaits en `u` ou `ens`.
10. **TVA** : devis assujettis (TVA travaux), sauf cas de sous-traitance ou mention
    `AUTOLIQUIDATION DE LA TVA`.

---

## 6. Notes techniques pour l'implementation (re-seed et lecture API)

- **Recuperation** : `GET /quotes?_expand=lines&_limit=1000` (meta-params en underscore,
  voir memoire projet sur les quirks Costructor). `_limit` est obligatoire car la liste
  est sinon plafonnee a 10. `metadata.items` donne le total reel.
- **Ligne authoritative = niveau racine de `quote.lines`.** Chaque ligne possede aussi un
  champ `lines` (enfants imbriques) qui est une **vue redondante** : le `subtotal` du devis
  egale la somme des `subtotal` des lignes de PREMIER niveau. **Ne pas recurser** dans les
  enfants pour les totaux ou les comptages, sinon on double les montants (verifie 2026-05-28).
- **Montants en centimes** : `sellPrice` 14980 = 149,80 euros.
- **Types de ligne** : `text` (titre de section / NB / mention legale, sans prix) et
  `product` (poste chiffre). L'unite est dans `unit {id, name, symbol}` (`m²`, `ml`, `u`,
  `m³`, `ens`).
- **HTML dans les descriptions** : conserver `<div>`, `<strong>`, `<span style>` a l'affichage.
- Les lignes optionnelles (`optional:true`) et `offert` (0 euro) existent et ne sont pas
  comptees dans le `subtotal`.
