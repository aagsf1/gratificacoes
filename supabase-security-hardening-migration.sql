-- Aplicar a instalações existentes após as migrações de referências e histórico.
-- Preserva as políticas RLS das tabelas subjacentes na visão.
alter view public.gratificacoes_detalhadas set (security_invoker=true);

-- Gatilhos são disparados pelo PostgreSQL, sem EXECUTE direto pela Data API.
revoke execute on function public.handle_new_user(), public.touch_and_actor(),
  public.audit_change(), public.normalize_reference(), public.touch_scenario()
  from public,anon,authenticated;

-- Auxiliares das políticas RLS são necessários ao usuário autenticado.
revoke execute on function public.current_role(), public.is_reader(),
  public.is_writer(), public.is_admin() from public,anon;
grant execute on function public.current_role(), public.is_reader(),
  public.is_writer(), public.is_admin() to authenticated;
