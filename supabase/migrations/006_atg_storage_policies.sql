-- =============================================================
-- 006 - Policies Storage pour les uploads de visite (anon)
-- =============================================================
-- L'app est en mode single-user : elle s'authentifie par son propre
-- cookie de login (middleware), PAS par Supabase Auth. Le client
-- navigateur uploade donc avec la cle ANON (auth.uid() est NULL).
--
-- Sur un projet neuf, storage.objects a la RLS ACTIVEE mais aucune
-- policy => le role anon est refuse sur tout upload, ce qui casse la
-- prise de photo et l'enregistrement vocal de l'ecran de visite.
--
-- On autorise donc explicitement anon (et authenticated) a lire/ecrire
-- UNIQUEMENT les buckets que le client navigateur touche : photos + audio.
--   - upload                       = INSERT (WITH CHECK)
--   - getPublicUrl / createSignedUrl = SELECT (USING)
--   - remove (suppression chantier) = DELETE (USING)
-- Les buckets rapports / etat-devis restent verrouilles : ils ne sont
-- ecrits que cote serveur via le client admin (service_role ignore la RLS).

-- Nettoyage des policies "auth.uid()" de la migration 001 si presentes :
-- elles ne conviennent pas a cette app (aucune session Supabase Auth).
DROP POLICY IF EXISTS "Users can upload photos"     ON storage.objects;
DROP POLICY IF EXISTS "Public photo access"         ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload audio"      ON storage.objects;
DROP POLICY IF EXISTS "Users can view own audio"    ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own audio"  ON storage.objects;

DROP POLICY IF EXISTS "atg_anon_rw_photos_audio" ON storage.objects;
CREATE POLICY "atg_anon_rw_photos_audio" ON storage.objects
  FOR ALL TO anon, authenticated
  USING      (bucket_id IN ('photos','audio'))
  WITH CHECK (bucket_id IN ('photos','audio'));
