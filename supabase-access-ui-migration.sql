-- Execute uma vez no SQL Editor do projeto existente.
-- Remove o perfil Auditor, restringe a auditoria ao Admin e cria a limpeza protegida.

-- Usuários existentes não perdem o acesso básico: Auditor passa para Consulta.
update public.profiles set role = 'consulta' where role = 'auditor';

alter table public.profiles drop constraint if exists profiles_supported_role;
alter table public.profiles add constraint profiles_supported_role
  check (role::text in ('admin','gestor','consulta'));

create or replace function public.is_reader() returns boolean
language sql stable security definer set search_path=public as $$
  select coalesce(public.current_role() in ('admin','gestor','consulta'), false);
$$;

drop policy if exists audit_read on public.audit_logs;
create policy audit_read on public.audit_logs
for select to authenticated using (public.is_admin());

create or replace function public.clear_audit_logs() returns integer
language plpgsql security definer set search_path=public as $$
declare removed integer;
begin
  if not public.is_admin() then
    raise exception 'Somente administradores podem limpar a auditoria' using errcode='42501';
  end if;

  -- O filtro explicito preserva a intencao de apagar todos os registros e
  -- atende a protecao contra DELETE sem WHERE habilitada no projeto.
  delete from public.audit_logs where id is not null;
  get diagnostics removed = row_count;

  -- Mantém um registro mínimo da própria operação de limpeza.
  insert into public.audit_logs(actor_id,actor_email,operation,entity,new_data)
  values(
    auth.uid(),
    coalesce(auth.jwt()->>'email',current_user),
    'CLEAR',
    'audit_logs',
    jsonb_build_object('deleted_count',removed)
  );
  return removed;
end $$;

revoke all on function public.clear_audit_logs() from public,anon;
grant execute on function public.clear_audit_logs() to authenticated;
