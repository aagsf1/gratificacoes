-- Referências financeiras versionadas por competência.
-- Seguro para execução no projeto existente; não remove gratificações nem logs.

alter table public.tipos_gratificacao
  add column if not exists valor_com_vinculo_manual numeric(14,4)
  check (valor_com_vinculo_manual is null or valor_com_vinculo_manual >= 0);

create table if not exists public.referencias_financeiras (
  id uuid primary key default gen_random_uuid(),
  cenario_id uuid not null references public.cenarios(id) on delete cascade,
  tipo_id uuid not null references public.tipos_gratificacao(id),
  valor_integral numeric(14,4) not null check (valor_integral >= 0),
  percentual_com_vinculo numeric(7,6) not null default .65
    check (percentual_com_vinculo between 0 and 1),
  valor_com_vinculo numeric(14,4) not null check (valor_com_vinculo >= 0),
  valor_personalizado boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  unique (cenario_id, tipo_id)
);

create unique index if not exists cenarios_competencia_unique
  on public.cenarios (competencia);
create index if not exists referencias_financeiras_cenario_idx
  on public.referencias_financeiras (cenario_id);

create or replace function public.normalize_reference() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  if not new.valor_personalizado then
    new.valor_com_vinculo := round(new.valor_integral * new.percentual_com_vinculo, 4);
  end if;
  return new;
end $$;

drop trigger if exists referencias_normalize on public.referencias_financeiras;
create trigger referencias_normalize before insert or update
on public.referencias_financeiras for each row
execute function public.normalize_reference();

drop trigger if exists audit_referencias on public.referencias_financeiras;
create trigger audit_referencias after insert or update or delete
on public.referencias_financeiras for each row
execute function public.audit_change();

alter table public.referencias_financeiras enable row level security;
drop policy if exists referencias_read on public.referencias_financeiras;
drop policy if exists referencias_write on public.referencias_financeiras;
create policy referencias_read on public.referencias_financeiras
  for select to authenticated using (public.is_writer());
create policy referencias_write on public.referencias_financeiras
  for all to authenticated using (public.is_writer()) with check (public.is_writer());

drop policy if exists cenarios_admin_write on public.cenarios;
drop policy if exists cenarios_writer_write on public.cenarios;
create policy cenarios_writer_write on public.cenarios
  for all to authenticated using (public.is_writer()) with check (public.is_writer());

grant select,insert,update,delete on public.referencias_financeiras to authenticated;

insert into public.referencias_financeiras (
  cenario_id,tipo_id,valor_integral,percentual_com_vinculo,valor_com_vinculo,valor_personalizado,ativo
)
select c.id,t.id,t.valor_integral,t.percentual_com_vinculo,
       coalesce(t.valor_com_vinculo_manual,t.valor_com_vinculo),
       t.valor_com_vinculo_manual is not null,t.ativo
from public.cenarios c cross join public.tipos_gratificacao t
on conflict (cenario_id,tipo_id) do nothing;

create or replace view public.referencias_financeiras_detalhadas
with (security_invoker=true) as
select r.*,t.codigo,t.descricao,c.competencia,c.orcamento_paradigma,c.status
from public.referencias_financeiras r
join public.tipos_gratificacao t on t.id=r.tipo_id
join public.cenarios c on c.id=r.cenario_id;
grant select on public.referencias_financeiras_detalhadas to authenticated;

create or replace view public.gratificacoes_detalhadas
with (security_invoker=true) as
select g.*,t.codigo tipo_codigo,
       coalesce(r.valor_integral,t.valor_integral) valor_integral,
       coalesce(r.percentual_com_vinculo,t.percentual_com_vinculo)::numeric(7,4) percentual_com_vinculo,
       coalesce(r.valor_com_vinculo,t.valor_com_vinculo_manual,t.valor_com_vinculo) valor_com_vinculo,
       case when g.com_vinculo
         then coalesce(r.valor_com_vinculo,t.valor_com_vinculo_manual,t.valor_com_vinculo)
         else coalesce(r.valor_integral,t.valor_integral)
       end valor_pago
from public.gratificacoes g
join public.tipos_gratificacao t on t.id=g.tipo_id
left join public.referencias_financeiras r
  on r.tipo_id=g.tipo_id and r.ativo
  and r.cenario_id=(select id from public.cenarios where status='VIGENTE' limit 1);
grant select on public.gratificacoes_detalhadas to authenticated;

create or replace function public.save_financial_references(
  p_cenario_id uuid,
  p_competencia date,
  p_orcamento_paradigma numeric,
  p_activate boolean,
  p_references jsonb
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
    raise exception 'Somente administradores e gestores podem alterar referências' using errcode='42501';
  end if;
  if p_competencia is null or p_competencia <> date_trunc('month',p_competencia)::date then
    raise exception 'A competência deve usar o primeiro dia do mês';
  end if;
  if p_orcamento_paradigma is null or p_orcamento_paradigma < 0 then
    raise exception 'Orçamento paradigma inválido';
  end if;
  if jsonb_typeof(p_references) <> 'array' or jsonb_array_length(p_references) <> 4
     or (select count(distinct value->>'codigo') from jsonb_array_elements(p_references)) <> 4
     or exists (
       select 1 from jsonb_array_elements(p_references)
       where value->>'codigo' not in ('CJ-01','CJ-02','CJ-03','CJ-04')
     ) then
    raise exception 'Informe exatamente uma referência para cada CJ-01, CJ-02, CJ-03 e CJ-04';
  end if;

  if target_id is null then
    insert into public.cenarios(nome,competencia,orcamento_paradigma,status,observacoes)
    values(
      'Referências — ' || to_char(p_competencia,'MM/YYYY'),
      p_competencia,p_orcamento_paradigma,'RASCUNHO'::public.cenario_status,
      'Parâmetros financeiros administrados pela página Referências.'
    ) returning id into target_id;
  else
    if not exists (select 1 from public.cenarios where id=target_id) then
      raise exception 'Competência não encontrada';
    end if;
    update public.cenarios set
      nome='Referências — ' || to_char(p_competencia,'MM/YYYY'),
      competencia=p_competencia,
      orcamento_paradigma=p_orcamento_paradigma
    where id=target_id;
  end if;

  if p_activate then
    update public.cenarios set status='APROVADO' where status='VIGENTE' and id<>target_id;
    update public.cenarios set status='VIGENTE' where id=target_id;
  elsif exists (select 1 from public.cenarios where id=target_id and status='VIGENTE') then
    update public.cenarios set status='APROVADO' where id=target_id;
  end if;

  for item in select value from jsonb_array_elements(p_references)
  loop
    select id into target_type_id from public.tipos_gratificacao where codigo=item->>'codigo';
    integral_value := (item->>'valor_integral')::numeric;
    percentage_value := coalesce((item->>'percentual_com_vinculo')::numeric,.65);
    custom_value := coalesce((item->>'valor_personalizado')::boolean,false);
    linked_value := case when custom_value
      then (item->>'valor_com_vinculo')::numeric
      else round(integral_value*percentage_value,4)
    end;
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
      valor_personalizado=excluded.valor_personalizado,
      ativo=excluded.ativo;
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

revoke all on function public.save_financial_references(uuid,date,numeric,boolean,jsonb) from public,anon;
grant execute on function public.save_financial_references(uuid,date,numeric,boolean,jsonb) to authenticated;

alter table public.user_presence drop constraint if exists user_presence_current_view_check;
alter table public.user_presence add constraint user_presence_current_view_check
  check (current_view in ('dashboard','gratificacoes','relatorios','referencias','auditoria','administracao'));
