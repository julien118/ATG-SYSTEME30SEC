-- =============================================
-- IONNYX Demo — Schéma complet
-- Projet Supabase : DÉMO VT (wobaadriaxwyuvrlrvnq)
-- Créé via MCP le 2026-04-11
-- =============================================

-- 1. Types ENUM
CREATE TYPE chantier_statut AS ENUM ('planifie', 'en_cours', 'termine', 'rapport_genere');
CREATE TYPE capture_type AS ENUM ('vocal', 'photo');

-- 2. Fonction utilitaire updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Table profiles
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  prenom TEXT NOT NULL,
  nom TEXT NOT NULL,
  telephone TEXT,
  metier TEXT,
  entreprise TEXT,
  rapports_generes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- Trigger: auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, prenom, nom, telephone, metier, entreprise)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'prenom', ''),
    COALESCE(NEW.raw_user_meta_data->>'nom', ''),
    NEW.raw_user_meta_data->>'telephone',
    NEW.raw_user_meta_data->>'metier',
    NEW.raw_user_meta_data->>'entreprise'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 4. Table chantiers
CREATE TABLE chantiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  client_nom TEXT NOT NULL,
  client_adresse TEXT,
  client_telephone TEXT,
  client_email TEXT,
  date_visite TIMESTAMPTZ,
  objet_travaux TEXT,
  statut chantier_statut NOT NULL DEFAULT 'planifie',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chantiers_user_id ON chantiers(user_id);
CREATE INDEX idx_chantiers_date_visite ON chantiers(date_visite);

CREATE TRIGGER chantiers_updated_at
  BEFORE UPDATE ON chantiers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE chantiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own chantiers"
  ON chantiers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own chantiers"
  ON chantiers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own chantiers"
  ON chantiers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own chantiers"
  ON chantiers FOR DELETE USING (auth.uid() = user_id);

-- 5. Table capture_items
CREATE TABLE capture_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id UUID NOT NULL REFERENCES chantiers ON DELETE CASCADE,
  type capture_type NOT NULL,
  position INTEGER,
  audio_url TEXT,
  transcription TEXT,
  photo_url TEXT,
  linked_photo_id UUID REFERENCES capture_items ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_capture_items_chantier_id ON capture_items(chantier_id);
CREATE INDEX idx_capture_items_position ON capture_items(position);
CREATE INDEX idx_capture_items_linked_photo ON capture_items(linked_photo_id);

ALTER TABLE capture_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own capture items"
  ON capture_items FOR SELECT USING (EXISTS (
    SELECT 1 FROM chantiers WHERE chantiers.id = capture_items.chantier_id AND chantiers.user_id = auth.uid()
  ));
CREATE POLICY "Users can insert own capture items"
  ON capture_items FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM chantiers WHERE chantiers.id = capture_items.chantier_id AND chantiers.user_id = auth.uid()
  ));
CREATE POLICY "Users can update own capture items"
  ON capture_items FOR UPDATE USING (EXISTS (
    SELECT 1 FROM chantiers WHERE chantiers.id = capture_items.chantier_id AND chantiers.user_id = auth.uid()
  ));
CREATE POLICY "Users can delete own capture items"
  ON capture_items FOR DELETE USING (EXISTS (
    SELECT 1 FROM chantiers WHERE chantiers.id = capture_items.chantier_id AND chantiers.user_id = auth.uid()
  ));

-- 6. Table rapports
CREATE TABLE rapports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id UUID NOT NULL UNIQUE REFERENCES chantiers ON DELETE CASCADE,
  contenu_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER rapports_updated_at
  BEFORE UPDATE ON rapports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE rapports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own rapports"
  ON rapports FOR SELECT USING (EXISTS (
    SELECT 1 FROM chantiers WHERE chantiers.id = rapports.chantier_id AND chantiers.user_id = auth.uid()
  ));
CREATE POLICY "Users can insert own rapports"
  ON rapports FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM chantiers WHERE chantiers.id = rapports.chantier_id AND chantiers.user_id = auth.uid()
  ));
CREATE POLICY "Users can update own rapports"
  ON rapports FOR UPDATE USING (EXISTS (
    SELECT 1 FROM chantiers WHERE chantiers.id = rapports.chantier_id AND chantiers.user_id = auth.uid()
  ));
CREATE POLICY "Users can delete own rapports"
  ON rapports FOR DELETE USING (EXISTS (
    SELECT 1 FROM chantiers WHERE chantiers.id = rapports.chantier_id AND chantiers.user_id = auth.uid()
  ));

-- 7. Storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('photos', 'photos', true);
INSERT INTO storage.buckets (id, name, public) VALUES ('audio', 'audio', false);

-- Storage policies: photos
CREATE POLICY "Users can upload photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'photos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can view own photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'photos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete own photos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'photos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Public photo access"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'photos');

-- Storage policies: audio
CREATE POLICY "Users can upload audio"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'audio' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can view own audio"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'audio' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete own audio"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'audio' AND auth.uid()::text = (storage.foldername(name))[1]);
