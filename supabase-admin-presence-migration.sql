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

-- Presence usa um canal privado: usuários ativos publicam a própria presença;
-- somente administradores recebem a lista consolidada.
drop policy if exists presence_active_user_track on realtime.messages;
create policy presence_active_user_track on realtime.messages
for insert to authenticated
with check (
  realtime.messages.extension = 'presence'
  and realtime.topic() = 'online-users'
  and public.is_reader()
);

drop policy if exists presence_admin_read on realtime.messages;
create policy presence_admin_read on realtime.messages
for select to authenticated
using (
  realtime.messages.extension = 'presence'
  and realtime.topic() = 'online-users'
  and public.is_admin()
);
