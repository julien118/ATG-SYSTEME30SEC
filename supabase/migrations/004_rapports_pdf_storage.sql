-- =============================================================
-- 004 - Persistance du PDF de compte rendu (Phase G, etape 1)
-- =============================================================
-- Colonne dediee pour l'URL stable du PDF stocke dans le Storage.
ALTER TABLE rapports ADD COLUMN IF NOT EXISTS pdf_url text;

-- Bucket public dedie aux PDF de compte rendu (deja cree via
-- scripts/setup-bucket-rapports.mts ; rejoue ici pour la reproductibilite).
INSERT INTO storage.buckets (id, name, public)
VALUES ('rapports', 'rapports', true)
ON CONFLICT (id) DO NOTHING;
