-- =============================================================
-- 010 - Tickets support Olivier -> Julien (canal Telegram)
-- =============================================================
-- Petit canal de support integre. Olivier envoie un message (texte seul) depuis
-- un bouton flottant ; le serveur le notifie sur Telegram a Julien (la MEME
-- discussion que les alertes de surveillance) et stocke le message_id Telegram.
-- Julien repond en "repondant" (reply) au message Telegram ; le webhook
-- (/api/telegram-webhook) retrouve le ticket par ce message_id et ecrit la
-- reponse. Olivier la voit dans "Mes demandes" (pastille non-lu).
--
-- Additif et idempotent (IF NOT EXISTS) : n'impacte aucune table metier existante.
-- RLS active, policy "authenticated" comme la migration 008 (le navigateur lit/ecrit
-- via la session d'Olivier sur GET/POST /api/tickets ; le webhook ecrit en
-- service_role qui ignore la RLS).

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Auteur. Mono-utilisateur : toujours ATG_USER_ID aujourd'hui, mais on garde la
  -- colonne pour rester multi-compte-ready (cf. note migration 008).
  user_id uuid not null,

  -- Chantier en cours au moment de l'envoi (contexte), s'il y en a un. PAS de FK
  -- stricte : un ticket doit survivre a la suppression d'un chantier (valeur de
  -- diagnostic historique). Le libelle est aussi copie dans `contexte`.
  chantier_id uuid,

  -- Le message d'Olivier (texte seul, v1).
  message text not null,

  -- Contexte auto-capture cote client : page courante, libelle chantier, viewport,
  -- userAgent... JSONB pour evoluer sans migration. Affiche dans la notif Telegram.
  contexte jsonb not null default '{}'::jsonb,

  -- Cycle de vie : 'ouvert' (envoye, pas encore de reponse) | 'repondu'.
  statut text not null default 'ouvert',

  -- Reponse de Julien (derniere recue). NULL tant qu'il n'a pas repondu.
  reponse text,
  repondu_le timestamptz,

  -- ID du message Telegram envoye a Julien. CLE DE MATCHING des reponses : le
  -- webhook lit message.reply_to_message.message_id et retrouve CE ticket.
  -- bigint car les message_id Telegram depassent la plage int32.
  telegram_message_id bigint,

  -- Pastille "reponse non lue" cote Olivier. Passe a false a l'arrivee d'une
  -- reponse, repasse a true quand Olivier ouvre "Mes demandes". default true :
  -- un ticket sans reponse n'allume jamais la pastille.
  lu_par_olivier boolean not null default true
);

-- Tri par recence dans "Mes demandes".
create index if not exists tickets_user_created_idx
  on public.tickets (user_id, created_at desc);

-- Matching O(1) des reponses Telegram par message_id (webhook).
create index if not exists tickets_telegram_msg_idx
  on public.tickets (telegram_message_id);

alter table public.tickets enable row level security;
drop policy if exists "atg_auth_all_tickets" on public.tickets;
create policy "atg_auth_all_tickets" on public.tickets
  for all to authenticated using (true) with check (true);
