-- Permite excluir definitivamente uma gratificação cadastrada por engano.
-- A auditoria existente em public.audit_gratificacoes registra a operação DELETE.
drop policy if exists gratificacoes_delete on public.gratificacoes;
create policy gratificacoes_delete on public.gratificacoes for delete to authenticated
  using (public.can_edit_scenario(cenario_id));

grant delete on public.gratificacoes to authenticated;
