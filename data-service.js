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

export async function loadApplicationData() {
  const [gratificacoes, tipos, cenarios, auditoria, perfis] = await Promise.all([
    db().from("gratificacoes_detalhadas").select("*").order("legacy_order", { ascending: true }),
    db().from("tipos_gratificacao").select("*").eq("ativo", true).order("codigo"),
    db().from("cenarios").select("*").order("competencia", { ascending: false }),
    db().from("audit_logs").select("*").order("created_at", { ascending: false }).limit(500),
    db().from("profiles").select("id,email,nome,role,ativo").order("nome"),
  ]);
  for (const result of [gratificacoes, tipos, cenarios]) if (result.error) throw result.error;
  return {
    gratificacoes: gratificacoes.data.filter(item => item.ativo),
    gratificacoesTodas: gratificacoes.data,
    tipos: tipos.data,
    cenarios: cenarios.data,
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
    ? db().from("gratificacoes").update({ ...payload, cenario_id: undefined }).eq("id", record.id)
    : db().from("gratificacoes").insert(payload);
  const { error } = await query;
  if (error) throw error;
}

export async function inactivateGrant(id) {
  const { error } = await db().from("gratificacoes").update({ ativo: false }).eq("id", id);
  if (error) throw error;
}

export async function updateProfile(id, role, ativo) {
  const { error } = await db().from("profiles").update({ role, ativo }).eq("id", id);
  if (error) throw error;
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
