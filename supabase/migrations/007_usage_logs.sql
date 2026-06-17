-- =============================================================
-- 007 - Journal d'usage IA (surveillance & reporting)
-- =============================================================
-- Table support du systeme de surveillance (digests hebdo/mensuels + cout).
-- Chaque generation Claude y ecrit une ligne (tokens entree/sortie + cout calcule
-- AU MOMENT DE L'ECRITURE, donc historiquement exact meme si les tarifs changent).
-- Lue par buildDigest() pour les rapports Telegram. Ecriture via service_role
-- (lib/supabase/admin.ts). Additif et idempotent (IF NOT EXISTS) : n'impacte
-- AUCUNE table ni AUCUN comportement metier existant.
--
-- Cout « forward-only » : ne compte qu'a partir de la creation de cette table +
-- activation. Les visites/rapports/photos/vocaux des digests, eux, sont comptes
-- retroactivement depuis les tables app (chantiers, rapports, capture_items).

create table if not exists public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  service text not null,
  model text,
  chantier_id uuid,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_usd numeric(12,6) not null default 0
);
create index if not exists usage_logs_created_at_idx on public.usage_logs (created_at);
create index if not exists usage_logs_service_idx on public.usage_logs (service);
alter table public.usage_logs enable row level security;
