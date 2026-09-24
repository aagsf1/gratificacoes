-- Mantém os nomes da API e retira implementações SECURITY DEFINER do esquema exposto.
-- Aplicar após supabase-production-grants-migration.sql e supabase-backup-migration.sql.
begin;

create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

alter function public.current_role() set schema app_private;
alter function public.is_reader() set schema app_private;
alter function public.is_writer() set schema app_private;
alter function public.is_admin() set schema app_private;
alter function public.can_edit_scenario(uuid) set schema app_private;
alter function public.clear_audit_logs() set schema app_private;
alter function public.save_financial_references(uuid,date,numeric,boolean,jsonb,uuid,boolean,boolean) set schema app_private;
alter function public.change_competence_status(uuid,public.cenario_status) set schema app_private;
alter function public.export_operational_backup(boolean) set schema app_private;
alter function public.restore_backup_as_new_competence(jsonb,date,text) set schema app_private;

revoke execute on all functions in schema app_private from public, anon, service_role;
grant execute on all functions in schema app_private to authenticated;

create function public.current_role() returns public.app_role
language sql stable security invoker set search_path=public as $$
  select app_private.current_role();
$$;
create function public.is_reader() returns boolean
language sql stable security invoker set search_path=public as $$
  select app_private.is_reader();
$$;
create function public.is_writer() returns boolean
language sql stable security invoker set search_path=public as $$
  select app_private.is_writer();
$$;
create function public.is_admin() returns boolean
language sql stable security invoker set search_path=public as $$
  select app_private.is_admin();
$$;
create function public.can_edit_scenario(target_id uuid) returns boolean
language sql stable security invoker set search_path=public as $$
  select app_private.can_edit_scenario(target_id);
$$;
create function public.clear_audit_logs() returns integer
language sql security invoker set search_path=public as $$
  select app_private.clear_audit_logs();
$$;
create function public.save_financial_references(
  p_cenario_id uuid, p_competencia date, p_orcamento_paradigma numeric,
  p_activate boolean, p_references jsonb, p_source_cenario_id uuid default null,
  p_copy_grants boolean default false, p_data_complete boolean default false
) returns uuid language sql security invoker set search_path=public as $$
  select app_private.save_financial_references(p_cenario_id,p_competencia,
    p_orcamento_paradigma,p_activate,p_references,p_source_cenario_id,
    p_copy_grants,p_data_complete);
$$;
create function public.change_competence_status(target_id uuid,target_status public.cenario_status)
returns void language sql security invoker set search_path=public as $$
  select app_private.change_competence_status(target_id,target_status);
$$;
create function public.export_operational_backup(p_include_audit boolean default false)
returns jsonb language sql security invoker set search_path=public as $$
  select app_private.export_operational_backup(p_include_audit);
$$;
create function public.restore_backup_as_new_competence(p_backup jsonb,p_competencia date,p_backup_id text)
returns uuid language sql security invoker set search_path=public as $$
  select app_private.restore_backup_as_new_competence(p_backup,p_competencia,p_backup_id);
$$;

revoke execute on function public.current_role(), public.is_reader(),
  public.is_writer(), public.is_admin(), public.can_edit_scenario(uuid),
  public.clear_audit_logs(),
  public.save_financial_references(uuid,date,numeric,boolean,jsonb,uuid,boolean,boolean),
  public.change_competence_status(uuid,public.cenario_status),
  public.export_operational_backup(boolean),
  public.restore_backup_as_new_competence(jsonb,date,text)
  from public, anon, service_role;
grant execute on function public.current_role(), public.is_reader(),
  public.is_writer(), public.is_admin(), public.can_edit_scenario(uuid),
  public.clear_audit_logs(),
  public.save_financial_references(uuid,date,numeric,boolean,jsonb,uuid,boolean,boolean),
  public.change_competence_status(uuid,public.cenario_status),
  public.export_operational_backup(boolean),
  public.restore_backup_as_new_competence(jsonb,date,text) to authenticated;

commit;
