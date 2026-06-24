-- =============================================================
-- 012 - Fils de discussion (tickets multi-tours)
-- =============================================================
-- Transforme les tickets "1 message -> 1 réponse" en vrais fils : table
-- ticket_messages (un message par tour, auteur olivier|julien), + meta sur tickets
-- (titre court IA, derniere_activite_le). Statut : 'ouvert' | 'resolu'.
-- Le matching des réponses Telegram se fait désormais via
-- ticket_messages.telegram_message_id (id du message bot posté). Backfill des
-- tickets existants (message d'ouverture + réponse) en messages de fil.
-- Additif et idempotent. Appliqué via MCP sur le projet prod bwysqnfdhdnwcmteyuph.

create table if not exists public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  auteur text not null,            -- 'olivier' | 'julien'
  texte text not null,
  telegram_message_id bigint,      -- id du message bot posté (matching des replies) ; null côté julien
  created_at timestamptz not null default now()
);
create index if not exists ticket_messages_ticket_idx on public.ticket_messages (ticket_id, created_at);
create index if not exists ticket_messages_tg_idx on public.ticket_messages (telegram_message_id);
alter table public.ticket_messages enable row level security;
drop policy if exists "atg_auth_all_ticket_messages" on public.ticket_messages;
create policy "atg_auth_all_ticket_messages" on public.ticket_messages
  for all to authenticated using (true) with check (true);

alter table public.tickets add column if not exists titre text;
alter table public.tickets add column if not exists derniere_activite_le timestamptz;

-- Backfill : message d'ouverture (olivier) depuis tickets.message
insert into public.ticket_messages (ticket_id, auteur, texte, telegram_message_id, created_at)
select t.id, 'olivier', t.message, t.telegram_message_id, t.created_at
from public.tickets t
where t.message is not null
  and not exists (select 1 from public.ticket_messages m where m.ticket_id = t.id);

-- Backfill : réponse existante (julien) depuis tickets.reponse
insert into public.ticket_messages (ticket_id, auteur, texte, created_at)
select t.id, 'julien', t.reponse, coalesce(t.repondu_le, t.created_at)
from public.tickets t
where t.reponse is not null
  and not exists (select 1 from public.ticket_messages m where m.ticket_id = t.id and m.auteur = 'julien');

-- Activité initiale + normalisation du statut ('repondu' -> 'ouvert')
update public.tickets set derniere_activite_le = coalesce(repondu_le, created_at) where derniere_activite_le is null;
update public.tickets set statut = 'ouvert' where statut is null or statut not in ('ouvert','resolu');
