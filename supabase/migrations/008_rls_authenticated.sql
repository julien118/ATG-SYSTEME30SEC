-- =============================================================
-- 008 - Verrouillage RLS (single-user, rôle "authenticated")
-- =============================================================
-- L'app a désormais une VRAIE session Supabase (Phase 1). On réactive la RLS
-- sur les tables que le NAVIGATEUR touche en direct, avec des policies cadrées
-- sur le rôle "authenticated" : seule une session Supabase valide (= Olivier
-- connecté) accède aux données. La clé anon PUBLIQUE, sans session, ne renvoie
-- plus rien → elle devient inerte même si elle fuite.
--
-- ⚠️ ORDRE OBLIGATOIRE : n'appliquer cette migration QU'APRÈS avoir (1) déployé
-- le code Phase 1 et (2) vérifié en prod qu'une connexion établit bien une
-- session Supabase. Sinon le navigateur d'Olivier (sans session) verrait ses
-- données vides. Retour arrière = `DISABLE ROW LEVEL SECURITY` (≈30 s).
--
-- MONO-UTILISATEUR, ÉVOLUTIF : on GARDE les colonnes user_id intactes. Pour
-- passer au multi-compte plus tard : (1) backfiller user_id vers l'uid réel,
-- puis (2) resserrer chaque policy de `USING (true)` à
-- `USING (user_id = auth.uid())` (ou via le chantier parent pour les enfants).
--
-- Les routes serveur PUBLIQUES (/r, /api/export-pdf) et privilégiées (devis/*)
-- lisent en service_role (admin) qui IGNORE la RLS → elles restent inchangées.
-- Les pages/routes authentifiées utilisent le client de session (cookies) qui,
-- avec la session d'Olivier, passe les policies "authenticated".

-- chantiers
ALTER TABLE chantiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atg_auth_all_chantiers" ON chantiers;
CREATE POLICY "atg_auth_all_chantiers" ON chantiers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- capture_items (photos + vocaux d'une visite)
ALTER TABLE capture_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atg_auth_all_capture_items" ON capture_items;
CREATE POLICY "atg_auth_all_capture_items" ON capture_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- rapports (comptes rendus)
ALTER TABLE rapports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atg_auth_all_rapports" ON rapports;
CREATE POLICY "atg_auth_all_rapports" ON rapports
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- profiles (profil de l'utilisateur)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atg_auth_all_profiles" ON profiles;
CREATE POLICY "atg_auth_all_profiles" ON profiles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Storage : remplace la policy ANON temporaire (006) par une policy AUTHENTICATED.
-- Les buckets photos/audio restent en lecture publique par URL (bucket public,
-- nécessaire pour les photos du CR client) — la RLS ici gouverne les ÉCRITURES
-- (upload/suppression) qui exigent désormais une session. Le passage des buckets
-- en privé est traité en Phase 3.
DROP POLICY IF EXISTS "atg_anon_rw_photos_audio" ON storage.objects;
DROP POLICY IF EXISTS "atg_auth_rw_photos_audio" ON storage.objects;
CREATE POLICY "atg_auth_rw_photos_audio" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id IN ('photos','audio'))
  WITH CHECK (bucket_id IN ('photos','audio'));
