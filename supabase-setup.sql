-- Execute uma única vez no SQL Editor de um projeto Supabase novo.
-- Este script usa somente auth.uid(); nenhuma chave secreta é necessária.
create extension if not exists pgcrypto;

create type public.app_role as enum ('admin','gestor','consulta','auditor');
create type public.cenario_status as enum ('RASCUNHO','EM ANÁLISE','APROVADO','ARQUIVADO','VIGENTE');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nome text,
  role public.app_role not null default 'consulta',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.tipos_gratificacao (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo in ('CJ-01','CJ-02','CJ-03','CJ-04')),
  descricao text not null,
  valor_integral numeric(14,4) not null check (valor_integral >= 0),
  percentual_com_vinculo numeric(7,4) not null default .65 check (percentual_com_vinculo between 0 and 1),
  valor_com_vinculo numeric(14,4) generated always as (valor_integral * percentual_com_vinculo) stored,
  vigencia_inicio date not null default current_date,
  vigencia_fim date check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  ativo boolean not null default true
);
create table public.cenarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  competencia date not null,
  orcamento_paradigma numeric(14,4) not null check (orcamento_paradigma >= 0),
  status public.cenario_status not null default 'RASCUNHO',
  observacoes text,
  created_at timestamptz not null default now()
);
create unique index one_current_scenario on public.cenarios ((status)) where status = 'VIGENTE';
create table public.gratificacoes (
  id uuid primary key default gen_random_uuid(),
  cenario_id uuid not null references public.cenarios(id),
  tipo_id uuid not null references public.tipos_gratificacao(id),
  unidade_sigla text not null,
  unidade_nome text not null,
  servidor_nome text,
  com_vinculo boolean not null,
  situacao text not null check (situacao in ('ANTIGA','NOVA','ALTERADA','EXTINTA','FUTURO','-')),
  observacoes text,
  legacy_order integer,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_email text,
  operation text not null,
  entity text not null,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create function public.current_role() returns public.app_role language sql stable security definer set search_path=public as $$
  select role from public.profiles where id = auth.uid() and ativo;
$$;
create function public.is_reader() returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(public.current_role() in ('admin','gestor','consulta','auditor'), false);
$$;
create function public.is_writer() returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(public.current_role() in ('admin','gestor'), false);
$$;
create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(public.current_role() = 'admin', false);
$$;

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,email,nome) values(new.id,coalesce(new.email,''),new.raw_user_meta_data->>'nome');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create function public.touch_and_actor() returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.updated_at = now(); new.updated_by = auth.uid();
  if tg_op = 'INSERT' then new.created_by = auth.uid(); end if;
  return new;
end $$;
create trigger gratificacoes_touch before insert or update on public.gratificacoes for each row execute function public.touch_and_actor();

create function public.audit_change() returns trigger language plpgsql security definer set search_path=public as $$
declare rid uuid; before_data jsonb; after_data jsonb;
begin
  if tg_op = 'DELETE' then rid := old.id; before_data := to_jsonb(old); after_data := null;
  elsif tg_op = 'INSERT' then rid := new.id; before_data := null; after_data := to_jsonb(new);
  else rid := new.id; before_data := to_jsonb(old); after_data := to_jsonb(new); end if;
  insert into public.audit_logs(actor_id,actor_email,operation,entity,record_id,old_data,new_data)
  values(auth.uid(),coalesce(auth.jwt()->>'email',current_user),tg_op,tg_table_name,rid,before_data,after_data);
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
create trigger audit_gratificacoes after insert or update or delete on public.gratificacoes for each row execute function public.audit_change();
create trigger audit_tipos after insert or update or delete on public.tipos_gratificacao for each row execute function public.audit_change();
create trigger audit_cenarios after insert or update or delete on public.cenarios for each row execute function public.audit_change();
create trigger audit_profiles after update on public.profiles for each row execute function public.audit_change();

create view public.gratificacoes_detalhadas with (security_invoker=true) as
select g.*,t.codigo tipo_codigo,t.valor_integral,t.percentual_com_vinculo,t.valor_com_vinculo,
       case when g.com_vinculo then t.valor_com_vinculo else t.valor_integral end valor_pago
from public.gratificacoes g join public.tipos_gratificacao t on t.id=g.tipo_id;

alter table public.profiles enable row level security;
alter table public.tipos_gratificacao enable row level security;
alter table public.cenarios enable row level security;
alter table public.gratificacoes enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_self_select on public.profiles for select using (id=auth.uid() or public.is_admin());
create policy profiles_admin_update on public.profiles for update using (public.is_admin()) with check (public.is_admin());
create policy tipos_read on public.tipos_gratificacao for select using (public.is_reader());
create policy tipos_admin_write on public.tipos_gratificacao for all using (public.is_admin()) with check (public.is_admin());
create policy cenarios_read on public.cenarios for select using (public.is_reader());
create policy cenarios_admin_write on public.cenarios for all using (public.is_admin()) with check (public.is_admin());
create policy gratificacoes_read on public.gratificacoes for select using (public.is_reader());
create policy gratificacoes_insert on public.gratificacoes for insert with check (public.is_writer());
create policy gratificacoes_update on public.gratificacoes for update using (public.is_writer()) with check (public.is_writer());
create policy audit_read on public.audit_logs for select using (public.current_role() in ('admin','auditor'));

-- Canal privado usado para exibir, somente aos administradores, quem está com o aplicativo aberto.
create policy presence_active_user_track on realtime.messages for insert to authenticated
with check (
  realtime.messages.extension = 'presence'
  and realtime.topic() = 'online-users'
  and public.is_reader()
);
create policy presence_admin_read on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'presence'
  and realtime.topic() = 'online-users'
  and public.is_admin()
);

revoke all on public.audit_logs from anon,authenticated;
grant select on public.profiles,public.tipos_gratificacao,public.cenarios,public.gratificacoes to authenticated;
grant insert,update on public.gratificacoes to authenticated;
grant update on public.profiles to authenticated;
grant insert,update,delete on public.tipos_gratificacao,public.cenarios to authenticated;
grant select on public.audit_logs to authenticated;
grant select on public.gratificacoes_detalhadas to authenticated;

insert into public.tipos_gratificacao(codigo,descricao,valor_integral,percentual_com_vinculo) values
('CJ-01','Cargo em comissão CJ-01',11870.0000,.6500),
('CJ-02','Cargo em comissão CJ-02',14659.7100,.6500),
('CJ-03','Cargo em comissão CJ-03',16665.1300,.6500),
('CJ-04','Cargo em comissão CJ-04',18812.9300,.6500);
insert into public.cenarios(nome,competencia,orcamento_paradigma,status,observacoes)
values('Situação proposta — agosto de 2026','2026-08-01',828146.7700,'VIGENTE','Base de regressão importada da planilha de referência.');

-- A base individualizada é carregada pelo bloco abaixo, gerado a partir da planilha.
-- Cole e execute o conteúdo de supabase-seed.sql após este arquivo.

-- Primeiro administrador (execute após criar o usuário em Authentication > Users):
-- update public.profiles set role='admin' where email='voce@exemplo.gov.br';
