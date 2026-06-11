-- =============================================================
-- 005 - Drapeau de moteur de generation sur le devis (socle ITE)
-- =============================================================
-- Prepare le cablage du moteur de clonage de modele (ITE) SANS rien changer au
-- comportement actuel : tout devis reste en moteur 'plat' par defaut, aucun
-- aiguillage n'est encore branche. Ce commit n'ajoute QUE des donnees.
--
--   moteur          : quel moteur a produit le devis.
--                     'plat'    = moteur historique (bibliotheque plate + IA),
--                                 comportement d'aujourd'hui (DEFAUT).
--                     'clonage' = moteur de clonage du devis-modele d'Olivier
--                                 (branche plus tard, ITE uniquement).
--   modele_id       : id du devis-modele Costructor clone (null en mode plat).
--   modele_snapshot : snapshot fige de l'arbre du modele (reponse GET
--                     _expand=lines) capture a la derivation, pour que le push
--                     en mode clonage reconstruise a l'identique sans
--                     re-interroger Costructor. null en mode plat.
--
-- Additif et idempotent (ADD COLUMN IF NOT EXISTS) : les devis existants
-- recoivent moteur='plat' (le defaut), donc strictement le comportement actuel.

ALTER TABLE devis ADD COLUMN IF NOT EXISTS moteur TEXT NOT NULL DEFAULT 'plat';
ALTER TABLE devis ADD COLUMN IF NOT EXISTS modele_id TEXT;
ALTER TABLE devis ADD COLUMN IF NOT EXISTS modele_snapshot JSONB;

-- Garde-fou de coherence : moteur limite aux deux valeurs connues. Ajout
-- idempotent (rejouable sans erreur) via un bloc garde.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'devis_moteur_check'
  ) THEN
    ALTER TABLE devis
      ADD CONSTRAINT devis_moteur_check CHECK (moteur IN ('plat', 'clonage'));
  END IF;
END $$;
