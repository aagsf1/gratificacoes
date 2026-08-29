-- Execute uma vez no SQL Editor do projeto existente.
-- Preserva gratificações e auditoria quando um usuário do Auth é excluído.
alter table public.gratificacoes
  drop constraint if exists gratificacoes_created_by_fkey,
  add constraint gratificacoes_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

alter table public.gratificacoes
  drop constraint if exists gratificacoes_updated_by_fkey,
  add constraint gratificacoes_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete set null;

-- Remove a autorização antiga do canal privado. Ela é mantida apenas para
-- instalações que já executaram a versão anterior desta migração.
drop policy if exists presence_active_user_track on realtime.messages;
drop policy if exists presence_admin_read on realtime.messages;

-- Heartbeat de cada aba/dispositivo. O desenho em tabela evita que a
-- autorização do Realtime Presence impeça perfis não administradores de
-- publicar que estão online.
create table if not exists public.user_presence (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  current_view text not null default 'dashboard'
    check (current_view in ('dashboard','gratificacoes','relatorios','auditoria','administracao')),
  connected_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create index if not exists user_presence_last_seen_idx
  on public.user_presence(last_seen desc);

alter table public.user_presence enable row level security;

drop policy if exists user_presence_read on public.user_presence;
create policy user_presence_read on public.user_presence
for select to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists user_presence_insert on public.user_presence;
create policy user_presence_insert on public.user_presence
for insert to authenticated
with check (user_id = auth.uid() and public.is_reader());

drop policy if exists user_presence_update on public.user_presence;
create policy user_presence_update on public.user_presence
for update to authenticated
using (user_id = auth.uid() and public.is_reader())
with check (user_id = auth.uid() and public.is_reader());

drop policy if exists user_presence_delete on public.user_presence;
create policy user_presence_delete on public.user_presence
for delete to authenticated
using (user_id = auth.uid());

revoke all on public.user_presence from anon;
grant select,insert,update,delete on public.user_presence to authenticated;
