-- =============================================================
-- 002_atg_consolidation.sql
-- Consolide les modifications appliquées au projet Supabase ATG
-- entre 2026-05-14 et 2026-05-25, hors migration versionnée.
-- Idempotent : rejouable sans casser une base déjà à jour.
--
-- Spécifique au fork ATG (mode single-user). À NE PAS appliquer
-- sur la démo IONNYX d'origine, qui reste multi-utilisateur.
-- =============================================================

-- 1. Suppression des contraintes FK vers auth.users
--    Le mode single-user utilise un UUID constant (ATG_USER_ID)
--    qui n'existe pas dans auth.users — les FK doivent être levées.
ALTER TABLE profiles  DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE chantiers DROP CONSTRAINT IF EXISTS chantiers_user_id_fkey;

-- 2. Désactivation de la Row Level Security sur toutes les tables
--    Plus rien à protéger en mode mono-utilisateur ; le service_role
--    et la clé anon partagent le même périmètre de données.
ALTER TABLE profiles      DISABLE ROW LEVEL SECURITY;
ALTER TABLE chantiers     DISABLE ROW LEVEL SECURITY;
ALTER TABLE capture_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE rapports      DISABLE ROW LEVEL SECURITY;

-- 3. Table devis (proposition IA + métrés + push Costructor)
CREATE TABLE IF NOT EXISTS devis (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id          UUID NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,
  statut               TEXT DEFAULT 'brouillon',
  sections_proposees   JSONB,
  sections_finales     JSONB,
  total_ht             NUMERIC,
  total_ttc            NUMERIC,
  costructor_devis_id  TEXT,
  costructor_devis_url TEXT,
  pousse_le            TIMESTAMPTZ,
  erreur_push          TEXT,
  cree_le              TIMESTAMPTZ NOT NULL DEFAULT now(),
  modifie_le           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devis_chantier_id ON devis(chantier_id);

ALTER TABLE devis DISABLE ROW LEVEL SECURITY;

-- 4. Table bibliotheque_costructor (cache local de la bibliothèque
--    articles Costructor d'Olivier, synchronisée à la main).
--    UNIQUE sur costructor_article_id : empêche les doublons à la synchro.
CREATE TABLE IF NOT EXISTS bibliotheque_costructor (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  costructor_article_id TEXT NOT NULL UNIQUE,
  libelle               TEXT NOT NULL,
  unite                 TEXT NOT NULL,
  prix_vente            NUMERIC NOT NULL,
  mots_cles             TEXT[],
  synchronise_le        TIMESTAMPTZ DEFAULT now()
);

-- Garantit la contrainte UNIQUE même si la table préexiste sans elle
-- (CREATE TABLE IF NOT EXISTS ne re-vérifie pas le schéma).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bibliotheque_costructor'::regclass
      AND contype = 'u'
      AND conkey = (
        SELECT array_agg(attnum)
        FROM pg_attribute
        WHERE attrelid = 'public.bibliotheque_costructor'::regclass
          AND attname = 'costructor_article_id'
      )
  ) THEN
    ALTER TABLE bibliotheque_costructor
      ADD CONSTRAINT bibliotheque_costructor_costructor_article_id_key
      UNIQUE (costructor_article_id);
  END IF;
END $$;

ALTER TABLE bibliotheque_costructor DISABLE ROW LEVEL SECURITY;
