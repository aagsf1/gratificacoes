-- Backup operacional e recuperação segura como nova competência.
-- Não restaura Auth, usuários, perfis ou credenciais e não sobrescreve dados existentes.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.export_operational_backup(p_include_audit boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare payload jsonb;
begin
  if not public.is_admin() then raise exception 'Somente administradores podem exportar backups' using errcode='42501'; end if;
  select jsonb_build_object(
    'format','gratificacoes-backup/v1',
    'generated_at',now(),
    'data',jsonb_build_object(
      'tipos',coalesce((select jsonb_agg(jsonb_build_object('codigo',codigo,'descricao',descricao) order by codigo) from public.tipos_gratificacao),'[]'::jsonb),
      'cenarios',coalesce((select jsonb_agg(jsonb_build_object('id',id,'nome',nome,'competencia',competencia,'orcamento_paradigma',orcamento_paradigma,'status',status,'observacoes',observacoes,'source_cenario_id',source_cenario_id,'dados_individualizados_completos',dados_individualizados_completos) order by competencia) from public.cenarios),'[]'::jsonb),
      'referencias',coalesce((select jsonb_agg(jsonb_build_object('cenario_id',r.cenario_id,'codigo',t.codigo,'valor_integral',r.valor_integral,'percentual_com_vinculo',r.percentual_com_vinculo,'valor_com_vinculo',r.valor_com_vinculo,'valor_personalizado',r.valor_personalizado,'ativo',r.ativo) order by r.cenario_id,t.codigo) from public.referencias_financeiras r join public.tipos_gratificacao t on t.id=r.tipo_id),'[]'::jsonb),
      'gratificacoes',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'cenario_id',g.cenario_id,'lineage_id',g.lineage_id,'codigo',t.codigo,'unidade_sigla',g.unidade_sigla,'unidade_nome',g.unidade_nome,'servidor_nome',g.servidor_nome,'com_vinculo',g.com_vinculo,'situacao',g.situacao,'observacoes',g.observacoes,'legacy_order',g.legacy_order,'ativo',g.ativo) order by g.cenario_id,g.legacy_order nulls last,g.id) from public.gratificacoes g join public.tipos_gratificacao t on t.id=g.tipo_id),'[]'::jsonb),
      'auditoria',case when p_include_audit then coalesce((select jsonb_agg(jsonb_build_object('created_at',created_at,'operation',operation,'entity',entity,'record_id',record_id,'old_data',old_data,'new_data',new_data) order by id) from public.audit_logs),'[]'::jsonb) else '[]'::jsonb end
    )
  ) into payload;
  payload := payload || jsonb_build_object('summary',jsonb_build_object('cenarios',jsonb_array_length(payload->'data'->'cenarios'),'referencias',jsonb_array_length(payload->'data'->'referencias'),'gratificacoes',jsonb_array_length(payload->'data'->'gratificacoes'),'auditoria',jsonb_array_length(payload->'data'->'auditoria')));
  return payload || jsonb_build_object('integrity',jsonb_build_object('sha256',encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex')));
end $$;

create or replace function public.restore_backup_as_new_competence(p_backup jsonb,p_competencia date,p_backup_id text)
returns uuid language plpgsql security definer set search_path=public as $$
declare source_id uuid; target_id uuid; row jsonb; reference_count integer; grant_count integer;
begin
  if not public.is_admin() then raise exception 'Somente administradores podem restaurar backups' using errcode='42501'; end if;
  if p_backup->>'format' <> 'gratificacoes-backup/v1' then raise exception 'Formato de backup incompatível'; end if;
  if p_competencia is null or p_competencia <> date_trunc('month',p_competencia)::date then raise exception 'A competência de destino é inválida'; end if;
  if exists(select 1 from public.cenarios where competencia=p_competencia) then raise exception 'Já existe uma competência para este mês'; end if;
  if jsonb_typeof(p_backup->'data'->'tipos') <> 'array' or jsonb_array_length(p_backup->'data'->'tipos') <> 4 or exists(select 1 from jsonb_array_elements(p_backup->'data'->'tipos') where value->>'codigo' not in ('CJ-01','CJ-02','CJ-03','CJ-04')) then raise exception 'Tipos de gratificação inválidos'; end if;
  source_id := nullif(p_backup_id,'')::uuid;
  select value into row from jsonb_array_elements(p_backup->'data'->'cenarios') where value->>'id'=source_id::text;
  if row is null then raise exception 'Competência de origem não encontrada no backup'; end if;
  select count(*) into reference_count from jsonb_array_elements(p_backup->'data'->'referencias') where value->>'cenario_id'=source_id::text;
  if reference_count <> 4 or exists(select 1 from jsonb_array_elements(p_backup->'data'->'referencias') where value->>'cenario_id'=source_id::text and (value->>'codigo' not in ('CJ-01','CJ-02','CJ-03','CJ-04') or (value->>'valor_integral')::numeric < 0 or (value->>'percentual_com_vinculo')::numeric not between 0 and 1 or (value->>'valor_com_vinculo')::numeric < 0)) then raise exception 'Referências financeiras inválidas'; end if;
  insert into public.cenarios(nome,competencia,orcamento_paradigma,status,observacoes,source_cenario_id,dados_individualizados_completos)
  values('Competência — '||to_char(p_competencia,'MM/YYYY'),p_competencia,(row->>'orcamento_paradigma')::numeric,'RASCUNHO',concat('Restaurada de backup: ',source_id::text),null,coalesce((row->>'dados_individualizados_completos')::boolean,false)) returning id into target_id;
  insert into public.referencias_financeiras(cenario_id,tipo_id,valor_integral,percentual_com_vinculo,valor_com_vinculo,valor_personalizado,ativo)
  select target_id,t.id,(value->>'valor_integral')::numeric,(value->>'percentual_com_vinculo')::numeric,(value->>'valor_com_vinculo')::numeric,coalesce((value->>'valor_personalizado')::boolean,false),coalesce((value->>'ativo')::boolean,true)
  from jsonb_array_elements(p_backup->'data'->'referencias') join public.tipos_gratificacao t on t.codigo=value->>'codigo' where value->>'cenario_id'=source_id::text;
  insert into public.gratificacoes(cenario_id,tipo_id,lineage_id,unidade_sigla,unidade_nome,servidor_nome,com_vinculo,situacao,observacoes,legacy_order,ativo)
  select target_id,t.id,(value->>'lineage_id')::uuid,value->>'unidade_sigla',value->>'unidade_nome',nullif(value->>'servidor_nome',''),(value->>'com_vinculo')::boolean,value->>'situacao',nullif(value->>'observacoes',''),nullif(value->>'legacy_order','')::integer,coalesce((value->>'ativo')::boolean,true)
  from jsonb_array_elements(p_backup->'data'->'gratificacoes') join public.tipos_gratificacao t on t.codigo=value->>'codigo' where value->>'cenario_id'=source_id::text;
  get diagnostics grant_count = row_count;
  insert into public.audit_logs(actor_id,actor_email,operation,entity,record_id,new_data)
  values(auth.uid(),coalesce(auth.jwt()->>'email',current_user),'RESTORE_BACKUP','cenarios',target_id,jsonb_build_object('backup_source_id',source_id,'validation','success','references',reference_count,'gratificacoes',grant_count));
  return target_id;
end $$;

revoke all on function public.export_operational_backup(boolean) from public,anon;
revoke all on function public.restore_backup_as_new_competence(jsonb,date,text) from public,anon;
grant execute on function public.export_operational_backup(boolean) to authenticated;
grant execute on function public.restore_backup_as_new_competence(jsonb,date,text) to authenticated;
