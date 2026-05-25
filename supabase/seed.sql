-- =============================================================
-- seed.sql — Données initiales du fork ATG (single-user)
-- Rejouable : ON CONFLICT DO NOTHING.
-- =============================================================

-- Profil unique référencé par ATG_USER_ID dans lib/atg.ts.
-- Valeurs reprises de la ligne existante en base au 2026-05-25.
INSERT INTO profiles (id, prenom, nom, telephone, metier, entreprise, rapports_generes)
VALUES (
  '00000000-0000-0000-0000-0000000000a7',
  'Olivier',
  'GRAVIOU',
  NULL,
  NULL,
  'ATG',
  0
)
ON CONFLICT (id) DO NOTHING;
