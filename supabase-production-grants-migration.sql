-- Migração idempotente para instalações existentes, sem modificar dados.
begin;

revoke all on public.profiles, public.tipos_gratificacao, public.cenarios,
  public.gratificacoes, public.audit_logs, public.user_presence,
  public.referencias_financeiras, public.gratificacoes_detalhadas,
  public.referencias_financeiras_detalhadas
  from anon, authenticated, service_role;

grant select on public.profiles, public.tipos_gratificacao, public.cenarios,
  public.gratificacoes, public.audit_logs, public.user_presence,
  public.referencias_financeiras, public.gratificacoes_detalhadas,
  public.referencias_financeiras_detalhadas to authenticated;
grant update on public.profiles to authenticated;
grant insert, update, delete on public.tipos_gratificacao, public.cenarios,
  public.gratificacoes, public.user_presence, public.referencias_financeiras
  to authenticated;

-- As Edge Functions de gestão de usuários usam a chave de serviço no servidor.
grant select, update on public.profiles to service_role;
grant insert on public.audit_logs to service_role;

alter view public.gratificacoes_detalhadas set (security_invoker=true);

revoke execute on function public.handle_new_user(), public.touch_and_actor(),
  public.audit_change(), public.normalize_reference(), public.touch_scenario()
  from public, anon, authenticated;
revoke execute on function public.current_role(), public.is_reader(),
  public.is_writer(), public.is_admin() from public, anon;
grant execute on function public.current_role(), public.is_reader(),
  public.is_writer(), public.is_admin() to authenticated;

commit;
