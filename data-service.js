import { getSupabase } from "./supabase-client.js?v=20260829-admin";

function db() {
  const client = getSupabase();
  if (!client) throw new Error("Supabase não configurado.");
  return client;
}

async function functionResponse(data, error) {
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json();
      if (body?.error) message = body.error;
    } catch { /* A resposta já foi consumida ou não contém JSON. */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function loadApplicationData(role) {
  const isAdmin = role === "admin";
  const isWriter = ["admin", "gestor"].includes(role);
  const [gratificacoes, tipos, cenarios, referencias, auditoria, perfis] = await Promise.all([
    db().from("gratificacoes_detalhadas").select("*").order("legacy_order", { ascending: true }),
    db().from("tipos_gratificacao").select("*").eq("ativo", true).order("codigo"),
    db().from("cenarios").select("*").order("competencia", { ascending: false }),
    isWriter ? db().from("referencias_financeiras_detalhadas").select("*").order("codigo") : Promise.resolve({ data: [], error: null }),
    isAdmin ? db().from("audit_logs").select("*").order("created_at", { ascending: false }).limit(500) : Promise.resolve({ data: [], error: null }),
    isAdmin ? db().from("profiles").select("id,email,nome,role,ativo").order("nome") : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [gratificacoes, tipos, cenarios, referencias]) if (result.error) throw result.error;
  return {
    gratificacoes: gratificacoes.data.filter(item => item.ativo),
    gratificacoesTodas: gratificacoes.data,
    tipos: tipos.data,
    cenarios: cenarios.data,
    referencias: referencias.data,
    auditoria: auditoria.error ? [] : auditoria.data,
    perfis: perfis.error ? [] : perfis.data,
  };
}

export async function saveGrant(record) {
  const payload = {
    id: record.id || undefined,
    cenario_id: record.cenario_id,
    tipo_id: record.tipo_id,
    unidade_sigla: record.unidade_sigla.trim().toUpperCase(),
    unidade_nome: record.unidade_nome.trim(),
    servidor_nome: record.servidor_nome.trim() || null,
    com_vinculo: record.com_vinculo,
    situacao: record.situacao,
    observacoes: record.observacoes?.trim() || null,
    ativo: true,
  };
  const query = record.id
    ? db().from("gratificacoes").update({ ...payload, cenario_id: undefined })
      .eq("id", record.id).eq("lock_version", Number(record.lock_version)).select("id").maybeSingle()
    : db().from("gratificacoes").insert(payload).select("id").single();
  const { data, error } = await query;
  if (error) throw error;
  if (record.id && !data) throw new Error("Esta gratificação foi alterada por outra sessão. Recarregue os dados e tente novamente.");
}

export async function inactivateGrant(id, lockVersion) {
  const { data, error } = await db().from("gratificacoes").update({ ativo: false })
    .eq("id", id).eq("lock_version", Number(lockVersion)).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Esta gratificação foi alterada por outra sessão. Recarregue os dados e tente novamente.");
}

export async function updateUser(user) {
  const { data, error } = await db().functions.invoke("update-user", {
    body: {
      userId: user.id,
      nome: user.nome.trim(),
      email: user.email.trim().toLowerCase(),
      role: user.role,
      ativo: user.ativo,
    },
  });
  return functionResponse(data, error);
}

export async function deleteGrant(id, lockVersion) {
  const { data, error } = await db().from("gratificacoes").delete()
    .eq("id", id).eq("lock_version", Number(lockVersion)).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Esta gratificação foi alterada por outra sessão. Recarregue os dados e tente novamente.");
}

export async function inviteUser(nome, email, role) {
  const { data, error } = await db().functions.invoke("invite-user", {
    body: { nome: nome.trim(), email: email.trim().toLowerCase(), role },
  });
  return functionResponse(data, error);
}

export async function deleteUser(userId) {
  const { data, error } = await db().functions.invoke("delete-user", {
    body: { userId },
  });
  return functionResponse(data, error);
}

export async function saveFinancialReferences(payload) {
  const { data, error } = await db().rpc("save_financial_references", {
    p_cenario_id: payload.cenarioId || null,
    p_competencia: `${payload.competencia}-01`,
    p_orcamento_paradigma: payload.orcamentoParadigma,
    p_activate: payload.activate,
    p_references: payload.references,
    p_source_cenario_id: payload.sourceScenarioId || null,
    p_copy_grants: Boolean(payload.copyGrants),
    p_data_complete: Boolean(payload.dataComplete),
  });
  if (error) throw error;
  return data;
}

export async function changeCompetenceStatus(cenarioId, status) {
  const { error } = await db().rpc("change_competence_status", {
    target_id: cenarioId,
    target_status: status,
  });
  if (error) throw error;
}

export async function clearAuditLogs() {
  const { data, error } = await db().rpc("clear_audit_logs");
  if (error) throw error;
  return Number(data ?? 0);
}

export async function exportOperationalBackup(includeAudit = false) {
  const { data, error } = await db().functions.invoke("backup-data", { body: { action: "export", includeAudit: Boolean(includeAudit) } });
  return functionResponse(data, error).then(result => result.data);
}

export async function restoreBackupAsNewCompetence(backup, competence, sourceScenarioId) {
  const { data, error } = await db().functions.invoke("backup-data", { body: { action: "restore", backup, competence, sourceScenarioId } });
  return functionResponse(data, error).then(result => result.data);
}
