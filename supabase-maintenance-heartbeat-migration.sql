-- Atividade técnica isolada para evitar pausa por inatividade no plano gratuito.
-- Esta rotina não altera tabelas operacionais, usuários, perfis ou auditoria funcional.

create schema if not exists maintenance;
revoke all on schema maintenance from public, anon, authenticated;

create table if not exists maintenance.heartbeats (
  id bigint generated always as identity primary key,
  executed_at timestamptz not null default now(),
  routine_version text not null check (routine_version ~ '^[a-zA-Z0-9._-]{1,64}$'),
  scenario_count integer not null check (scenario_count >= 0),
  type_count integer not null check (type_count >= 0),
  reference_count integer not null check (reference_count >= 0)
);

alter table maintenance.heartbeats enable row level security;
revoke all on maintenance.heartbeats from public, anon, authenticated;

create or replace function maintenance.run_heartbeat(p_routine_version text default 'v1')
returns jsonb
language plpgsql
security definer
set search_path = maintenance, public
as $$
declare
  last_run timestamptz;
  scenario_total integer;
  type_total integer;
  reference_total integer;
  executed_at timestamptz;
begin
  if p_routine_version !~ '^[a-zA-Z0-9._-]{1,64}$' then
    raise exception 'Versão técnica inválida' using errcode = '22023';
  end if;

  select max(h.executed_at) into last_run from maintenance.heartbeats h;
  if last_run is not null and last_run > now() - interval '24 hours' then
    raise exception 'Heartbeat técnico já executado nas últimas 24 horas' using errcode = 'P0001';
  end if;

  -- Leituras agregadas, sem dados pessoais ou operacionais individualizados.
  select count(*) into scenario_total from public.cenarios;
  select count(*) into type_total from public.tipos_gratificacao;
  select count(*) into reference_total from public.referencias_financeiras;

  insert into maintenance.heartbeats (routine_version, scenario_count, type_count, reference_count)
  values (p_routine_version, scenario_total, type_total, reference_total)
  returning maintenance.heartbeats.executed_at into executed_at;

  return jsonb_build_object('ok', true, 'executed_at', executed_at);
end;
$$;

-- O PostgREST expõe o schema public. A função continua inacessível a anon/authenticated.
create or replace function public.run_maintenance_heartbeat(p_routine_version text default 'v1')
returns jsonb
language sql
security definer
set search_path = maintenance, public
as $$
  select maintenance.run_heartbeat(p_routine_version);
$$;

revoke all on function maintenance.run_heartbeat(text) from public, anon, authenticated;
revoke all on function public.run_maintenance_heartbeat(text) from public, anon, authenticated;
grant usage on schema maintenance to service_role;
grant execute on function maintenance.run_heartbeat(text) to service_role;
grant execute on function public.run_maintenance_heartbeat(text) to service_role;
