-- =============================================================
-- 003_seed_bibliotheque_atg.sql
-- Seed de la bibliotheque de demo au STYLE OLIVIER (compte Costructor de JULIEN).
-- Genere par scripts/reseed-bibliotheque-atg.mjs le 2026-05-28.
-- Intitules repris VERBATIM des vrais devis d'Olivier (cf. STYLE-OLIVIER.md).
--
-- ATTENTION : les costructor_article_id ci-dessous pointent vers les produits
-- du compte de JULIEN. Sur un autre compte Costructor, recreer les produits et
-- regenerer ce fichier via le script. Idempotent : rejouable (DELETE puis INSERT).
-- =============================================================

DELETE FROM bibliotheque_costructor;

INSERT INTO bibliotheque_costructor (costructor_article_id, libelle, unite, prix_vente, mots_cles) VALUES
  ('prod_01ksqm3kjryze2yvh0xtknbbsr', 'Déplacement, installation du chantier, mise en place matériel d''élévation, nettoyage de fin de chantier, repli', 'u', 549, ARRAY['déplacement', 'installation', 'repli']::text[]),
  ('prod_01ksqm3kn9dsj7y34p54evhxs5', 'Amené du matériel, montage échafaudage Comabi R200 Progress (conforme aux normes de montage en sécurité), repli du matériel', 'm²', 8.2, ARRAY['échafaudage', 'comabi']::text[]),
  ('prod_01ksqm3kqwmeqw5jdmdyherz2x', 'Lavage façade moyenne ou haute pression', 'm²', 3.8, ARRAY['lavage']::text[]),
  ('prod_01ksqm3kterfkxkt4nsna6n2kp', 'Traitement algicide, fongicide, issu de la chimie raisonnée', 'm²', 3.9, ARRAY['traitement', 'algicide', 'fongicide']::text[]),
  ('prod_01ksqm3kx3mxfrzecsyrzbz2m0', 'Gestion des déchets : dépôt dans notre benne DIB, située 22 route de l''Aurore 37130 Mazières de Touraine, prestataire ETS Passenaud (compris traitement)', 'm³', 152.95, ARRAY['déchets', 'benne']::text[]),
  ('prod_01ksqm3kzq002mp3cgb6tezkyn', 'Ravalement I3 peinture HB Classification NF T 36-005 Famille I - classe 7b2-10c NF T 34-722 et DTU 42.1 : I1 à I4 selon système NF EN 1062-1 : E4à5V2W3A1à5 : après préparation du support, traitement des fissures à l''enduit fibré : - application 1 couche de Virtuotech Fixateur opacifiant 200g/m2 - application 1 couche de Virtuotech Inter 300g/m2 - application 1 couche de Virtuotech lisse 400g/m2', 'm²', 33.07, ARRAY['ravalement', 'i3', 'peinture']::text[]),
  ('prod_01ksqm3m2d77rf3qa7kctc5vnv', 'Ravalement I4 finition Talochée HB Classification NF T 36-005 Famille I - classe 7b2-10c NF T 34-722 et DTU 42.1 : I1 à I4 selon système NF EN 1062-1 : E4à5V2W3A1à5 : après préparation du support, traitement des fissures à l''enduit fibré : - application 1 couche de Virtuotech Fixateur opacifiant 200g/m2 - application 1 couche de Virtuotech Inter 300g/m2 avec marouflage d''une toile antifissure - application 1 couche de Virtuotech Inter 300g/m2 - application 1 couche de Virtuotech taloché grains fins 1.4kg/m2 Compris création d''une plinthe anti remontée capillaire de 20cm de haut, conforme au DTU, application 2 couches de Virtuolite (D2)', 'm²', 59.35, ARRAY['ravalement', 'i4', 'taloché']::text[]),
  ('prod_01ksqm3m4wcg9d74qqdrp48w4a', 'Façade : après préparation du support, traitement des fissures, fourniture et mise en oeuvre système de ravalement d''étanchéité type I4 avec entoilage', 'm²', 59.8, ARRAY['ravalement', 'i4', 'entoilage']::text[]),
  ('prod_01ksqm3m7h1p05ekdna5y83q0z', 'Système de ravalement d''imperméabilisation I3 10/10e épaisseur du système > 0.4mm selon classement norme NF P 84-403', 'm²', 49.9, ARRAY['ravalement', 'imperméabilisation', 'i3']::text[]),
  ('prod_01ksqm4k74yxq3fvmaeszcp4zp', 'Mur intérieur : après préparation du support, fourniture et mise en oeuvre système de ravalement d''étanchéité type I3 taloché conforme norme NF P 84403 et NF EN1062-1', 'm²', 58.8, ARRAY['ravalement', 'i3', 'taloché', 'mur']::text[]),
  ('prod_01ksqm4kktqzbhg3b3gxp75rb8', 'Fourniture et mise en oeuvre système d''Isolation Thermique Extérieur Système BAUMIT STARSYSTEM : calé, chevillé, compris rails de départ, accessoires de renforts d''angles, mousse de remplissage, arrêts latéraux et hauts, armature générale', 'm²', 149.8, ARRAY['ite', 'isolation', 'baumit', 'starsystem']::text[]),
  ('prod_01ksqm4m0cfesnmer8vcxvw8x5', 'Baumit ProTherm PSE BLANC épaisseur 140 mm R= 3.70 , ACERMI 12/081/793', 'm²', 21.7, ARRAY['pse', 'isolant', 'baumit']::text[]),
  ('prod_01ksqm4mcn0eqvn4qq400fszvg', 'PSE GRIS TH31 EPAIS. 140MM R=4.50 ACERMI N°17/201/1197 édition 6', 'm²', 21.62, ARRAY['pse', 'isolant']::text[]),
  ('prod_01ksqm4ms9417t8ge1sz701pfr', 'Isolation soubassement : fourniture et mise en oeuvre collée sur soubassements panneaux de Polystyrène type PS 30 SE 120MM, compris colle type Flexyl, enduit de base + treillis d''armature, finition peinture microporeuse Virtuolite 2 couches', 'ml', 138, ARRAY['soubassement', 'isolation']::text[]),
  ('prod_01ksqm4n5cw1jgpxpt9x0ww6d5', 'Découpe des appuis de fenêtres (compris mise à la benne des gravats) raccords polystyrène, pose appui de fenêtre isolant', 'ml', 105.5, ARRAY['appui', 'découpe']::text[]),
  ('prod_01ksqm4nhdg7a79jjgthnpc3tb', 'mise en peinture des appuis de fenêtres, après préparation du support, application 2 couches Sigmasol', 'ml', 34.05, ARRAY['appui', 'peinture']::text[]),
  ('prod_01ksqm4nxnpyy778xrrv8emzsw', 'Appui MSEA 1100MM PROF 390MM', 'u', 149.27, ARRAY['appui', 'msea']::text[]),
  ('prod_01ksqm4p9hgjserxev3k80d3a9', 'Corniches : préparation du support, application 2 couches de peinture décorative (D2)', 'ml', 19.3, ARRAY['corniche']::text[]),
  ('prod_01ksqm4s4re8gn02pb74waxz96', 'Dessous de toit (angle) grattage des parties mal adhérentes, nettoyage, ponçage, essuyage, application 2 couches de laque', 'ml', 38.5, ARRAY['dessous de toit']::text[]),
  ('prod_01ksqm4she7bw7rxqn9hcnntwv', 'Souche de cheminée : fourniture et mise en place matériel d''élévation, préparation du support, application 2 couches de peinture décorative (D2) teinte façade', 'u', 189, ARRAY['souche', 'cheminée']::text[]),
  ('prod_01ksqm4sxy90w5ahshtvt858jd', 'Descente d''eau pluviale, après préparation, application 2 couches de finition teinte façade', 'ml', 12.8, ARRAY['descente', 'eau pluviale']::text[]),
  ('prod_01ksqm4tabbfbkbxckrvrmgcck', 'Fourniture et pose de fixation pour descente EP, arrêt de volet, goulotte, charge légère...', 'u', 15.9, ARRAY['fixation', 'descente']::text[]);
