-- Versionamento integral das gratificações por competência.
-- Não cria dados históricos individuais que não existam e não remove registros.

begin;

alter table public.cenarios add column if not exists source_cenario_id uuid references public.cenarios(id) on delete set null;
alter table public.cenarios add column if not exists dados_individualizados_completos boolean not null default true;
alter table public.cenarios add column if not exists updated_at timestamptz not null default now();
alter table public.cenarios add column if not exists updated_by uuid references auth.users(id) on delete set null;

alter table public.gratificacoes add column if not exists lineage_id uuid;
update public.gratificacoes set lineage_id=id where lineage_id is null;
alter table public.gratificacoes alter column lineage_id set default gen_random_uuid();
alter table public.gratificacoes alter column lineage_id set not null;
alter table public.gratificacoes add column if not exists lock_version integer not null default 0;
create unique index if not exists gratificacoes_cenario_lineage_unique
  on public.gratificacoes(cenario_id,lineage_id);
create index if not exists gratificacoes_cenario_ativo_idx
  on public.gratificacoes(cenario_id,ativo);

create or replace function public.touch_and_actor() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.lineage_id := coalesce(new.lineage_id,new.id,gen_random_uuid());
    new.lock_version := 0;
  else
    new.lock_version := old.lock_version + 1;
  end if;
  return new;
end $$;

create or replace function public.touch_scenario() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists cenarios_touch on public.cenarios;
create trigger cenarios_touch before update on public.cenarios
for each row execute function public.touch_scenario();

create or replace function public.can_edit_scenario(target_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select public.is_writer() and exists(
    select 1 from public.cenarios
    where id=target_id and status in ('RASCUNHO','VIGENTE')
  );
$$;
revoke all on function public.can_edit_scenario(uuid) from public,anon;
grant execute on function public.can_edit_scenario(uuid) to authenticated;

drop policy if exists gratificacoes_insert on public.gratificacoes;
drop policy if exists gratificacoes_update on public.gratificacoes;
drop policy if exists gratificacoes_delete on public.gratificacoes;
create policy gratificacoes_insert on public.gratificacoes for insert to authenticated
  with check (public.can_edit_scenario(cenario_id));
create policy gratificacoes_update on public.gratificacoes for update to authenticated
  using (public.can_edit_scenario(cenario_id))
  with check (public.can_edit_scenario(cenario_id));
create policy gratificacoes_delete on public.gratificacoes for delete to authenticated
  using (public.can_edit_scenario(cenario_id));

grant delete on public.gratificacoes to authenticated;

drop view if exists public.gratificacoes_detalhadas;
create view public.gratificacoes_detalhadas
with (security_invoker=false,security_barrier=true) as
select
  g.id,g.cenario_id,g.tipo_id,g.unidade_sigla,g.unidade_nome,g.servidor_nome,
  g.com_vinculo,g.situacao,g.observacoes,g.legacy_order,g.ativo,
  g.created_at,g.updated_at,g.created_by,g.updated_by,g.lineage_id,g.lock_version,
  t.codigo tipo_codigo,
  coalesce(r.valor_integral,t.valor_integral)::numeric(14,4) valor_integral,
  coalesce(r.percentual_com_vinculo,t.percentual_com_vinculo)::numeric(7,4) percentual_com_vinculo,
  coalesce(r.valor_com_vinculo,t.valor_com_vinculo_manual,t.valor_com_vinculo)::numeric(14,4) valor_com_vinculo,
  case when g.com_vinculo
    then coalesce(r.valor_com_vinculo,t.valor_com_vinculo_manual,t.valor_com_vinculo)
    else coalesce(r.valor_integral,t.valor_integral)
  end::numeric(14,4) valor_pago,
  c.competencia,c.status cenario_status,c.dados_individualizados_completos
from public.gratificacoes g
join public.cenarios c on c.id=g.cenario_id
join public.tipos_gratificacao t on t.id=g.tipo_id
left join public.referencias_financeiras r
  on r.cenario_id=g.cenario_id and r.tipo_id=g.tipo_id and r.ativo
where public.is_reader();
grant select on public.gratificacoes_detalhadas to authenticated;

drop function if exists public.save_financial_references(uuid,date,numeric,boolean,jsonb);
drop function if exists public.save_financial_references(uuid,date,numeric,boolean,jsonb,uuid,boolean);
drop function if exists public.save_financial_references(uuid,date,numeric,boolean,jsonb,uuid,boolean,boolean);
create or replace function public.save_financial_references(
  p_cenario_id uuid,
  p_competencia date,
  p_orcamento_paradigma numeric,
  p_activate boolean,
  p_references jsonb,
  p_source_cenario_id uuid default null,
  p_copy_grants boolean default false,
  p_data_complete boolean default false
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  target_id uuid := p_cenario_id;
  item jsonb;
  target_type_id uuid;
  integral_value numeric(14,4);
  percentage_value numeric(7,6);
  linked_value numeric(14,4);
  custom_value boolean;
begin
  if not public.is_writer() then
    raise exception 'Somente administradores e gestores podem alterar competências' using errcode='42501';
  end if;
  if p_competencia is null or p_competencia <> date_trunc('month',p_competencia)::date then
    raise exception 'A competência deve usar o primeiro dia do mês';
  end if;
  if p_orcamento_paradigma is null or p_orcamento_paradigma < 0 then
    raise exception 'Orçamento paradigma inválido';
  end if;
  if jsonb_typeof(p_references) <> 'array' or jsonb_array_length(p_references) <> 4
     or (select count(distinct value->>'codigo') from jsonb_array_elements(p_references)) <> 4
     or exists (select 1 from jsonb_array_elements(p_references)
                where value->>'codigo' not in ('CJ-01','CJ-02','CJ-03','CJ-04')) then
    raise exception 'Informe exatamente uma referência para cada CJ-01, CJ-02, CJ-03 e CJ-04';
  end if;
  if p_copy_grants and p_source_cenario_id is null then
    raise exception 'Informe a competência de origem para copiar gratificações';
  end if;

  if target_id is null then
    if p_source_cenario_id is not null then
      perform 1 from public.cenarios where id=p_source_cenario_id;
      if not found then raise exception 'Competência de origem não encontrada'; end if;
    end if;
    insert into public.cenarios(
      nome,competencia,orcamento_paradigma,status,observacoes,
      source_cenario_id,dados_individualizados_completos
    ) values(
      'Competência — ' || to_char(p_competencia,'MM/YYYY'),p_competencia,
      p_orcamento_paradigma,'RASCUNHO',
      case when p_source_cenario_id is null then 'Competência criada sem cópia.' else 'Competência copiada de ' || p_source_cenario_id::text end,
      p_source_cenario_id,p_data_complete
    ) returning id into target_id;

    if p_copy_grants then
      insert into public.gratificacoes(
        cenario_id,tipo_id,unidade_sigla,unidade_nome,servidor_nome,
        com_vinculo,situacao,observacoes,legacy_order,ativo,lineage_id
      ) select
        target_id,tipo_id,unidade_sigla,unidade_nome,servidor_nome,
        com_vinculo,situacao,observacoes,legacy_order,ativo,lineage_id
      from public.gratificacoes where cenario_id=p_source_cenario_id;
    end if;
  else
    if not public.can_edit_scenario(target_id) then
      raise exception 'Competência encerrada, arquivada ou sem permissão para edição' using errcode='42501';
    end if;
    update public.cenarios set
      nome='Competência — ' || to_char(p_competencia,'MM/YYYY'),
      competencia=p_competencia,orcamento_paradigma=p_orcamento_paradigma,
      dados_individualizados_completos=p_data_complete
    where id=target_id;
  end if;

  if p_activate then
    update public.cenarios set status='APROVADO' where status='VIGENTE' and id<>target_id;
    update public.cenarios set status='VIGENTE' where id=target_id;
  elsif exists(select 1 from public.cenarios where id=target_id and status='VIGENTE') then
    update public.cenarios set status='APROVADO' where id=target_id;
  end if;

  for item in select value from jsonb_array_elements(p_references)
  loop
    select id into target_type_id from public.tipos_gratificacao where codigo=item->>'codigo';
    integral_value := (item->>'valor_integral')::numeric;
    percentage_value := coalesce((item->>'percentual_com_vinculo')::numeric,.65);
    custom_value := coalesce((item->>'valor_personalizado')::boolean,false);
    linked_value := case when custom_value then (item->>'valor_com_vinculo')::numeric
                         else round(integral_value*percentage_value,4) end;
    if integral_value < 0 or percentage_value < 0 or percentage_value > 1 or linked_value < 0 then
      raise exception 'Valores inválidos para %',item->>'codigo';
    end if;
    insert into public.referencias_financeiras(
      cenario_id,tipo_id,valor_integral,percentual_com_vinculo,
      valor_com_vinculo,valor_personalizado,ativo
    ) values(
      target_id,target_type_id,integral_value,percentage_value,
      linked_value,custom_value,coalesce((item->>'ativo')::boolean,true)
    ) on conflict(cenario_id,tipo_id) do update set
      valor_integral=excluded.valor_integral,
      percentual_com_vinculo=excluded.percentual_com_vinculo,
      valor_com_vinculo=excluded.valor_com_vinculo,
      valor_personalizado=excluded.valor_personalizado,ativo=excluded.ativo;
  end loop;

  if p_activate then
    update public.tipos_gratificacao t set
      valor_integral=r.valor_integral,
      percentual_com_vinculo=r.percentual_com_vinculo,
      valor_com_vinculo_manual=case when r.valor_personalizado then r.valor_com_vinculo else null end,
      ativo=r.ativo
    from public.referencias_financeiras r
    where r.cenario_id=target_id and r.tipo_id=t.id;
  end if;
  return target_id;
end $$;

revoke all on function public.save_financial_references(uuid,date,numeric,boolean,jsonb,uuid,boolean,boolean) from public,anon;
grant execute on function public.save_financial_references(uuid,date,numeric,boolean,jsonb,uuid,boolean,boolean) to authenticated;

create or replace function public.change_competence_status(target_id uuid,target_status public.cenario_status)
returns void language plpgsql security definer set search_path=public as $$
declare current_status public.cenario_status;
begin
  select status into current_status from public.cenarios where id=target_id;
  if not found then raise exception 'Competência não encontrada'; end if;
  if target_status='RASCUNHO' then
    if not public.is_admin() then raise exception 'Somente administradores podem reabrir competências' using errcode='42501'; end if;
  elsif target_status in ('APROVADO','ARQUIVADO') then
    if not public.is_writer() then raise exception 'Sem permissão para alterar a competência' using errcode='42501'; end if;
  else
    raise exception 'Transição de situação não permitida por esta operação';
  end if;
  if current_status='VIGENTE' and target_status='ARQUIVADO' then
    raise exception 'Encerre a competência vigente antes de arquivá-la';
  end if;
  update public.cenarios set status=target_status where id=target_id;
end $$;
revoke all on function public.change_competence_status(uuid,public.cenario_status) from public,anon;
grant execute on function public.change_competence_status(uuid,public.cenario_status) to authenticated;

commit;
