-- Execute no SQL Editor de um projeto de teste após os scripts de instalação.
-- Apenas consulta metadados; não altera dados nem privilégios.
with expected(role_name, object_name, privilege, allowed) as (
  values
    ('authenticated','public.profiles','SELECT',true),
    ('authenticated','public.profiles','UPDATE',true),
    ('authenticated','public.profiles','INSERT',false),
    ('authenticated','public.profiles','DELETE',false),
    ('service_role','public.profiles','SELECT',true),
    ('service_role','public.profiles','UPDATE',true),
    ('service_role','public.audit_logs','INSERT',true),
    ('service_role','public.gratificacoes','SELECT',false),
    ('authenticated','public.audit_logs','SELECT',true),
    ('authenticated','public.audit_logs','INSERT',false),
    ('authenticated','public.audit_logs','DELETE',false),
    ('authenticated','public.gratificacoes','SELECT',true),
    ('authenticated','public.gratificacoes','INSERT',true),
    ('authenticated','public.gratificacoes','UPDATE',true),
    ('authenticated','public.gratificacoes','DELETE',true),
    ('authenticated','public.referencias_financeiras','SELECT',true),
    ('authenticated','public.referencias_financeiras_detalhadas','SELECT',true),
    ('authenticated','public.gratificacoes_detalhadas','SELECT',true),
    ('authenticated','public.user_presence','INSERT',true),
    ('anon','public.profiles','SELECT',false),
    ('anon','public.tipos_gratificacao','SELECT',false),
    ('anon','public.cenarios','SELECT',false),
    ('anon','public.gratificacoes','SELECT',false),
    ('anon','public.audit_logs','SELECT',false),
    ('anon','public.user_presence','SELECT',false),
    ('anon','public.referencias_financeiras','SELECT',false),
    ('anon','public.gratificacoes_detalhadas','SELECT',false),
    ('anon','public.referencias_financeiras_detalhadas','SELECT',false)
), checked as (
  select role_name, object_name, privilege, allowed,
         has_table_privilege(role_name, object_name, privilege) as actual
  from expected
)
select *, case when actual is not distinct from allowed then 'OK' else 'FALHA' end as resultado
from checked
order by resultado, object_name, role_name, privilege;

select c.relname, c.relrowsecurity as rls_habilitada
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p')
  and c.relname in ('profiles','tipos_gratificacao','cenarios','gratificacoes',
                    'audit_logs','user_presence','referencias_financeiras')
order by c.relname;

select 'anon' as role_name, p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as acesso_anonimo
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('clear_audit_logs','save_financial_references','change_competence_status',
   'export_operational_backup','restore_backup_as_new_competence')
order by p.proname;
