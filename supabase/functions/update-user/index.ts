import { createClient } from "npm:@supabase/supabase-js@2";
import { normalizeUpdatePayload } from "./validation.js";

const siteUrl = Deno.env.get("SITE_URL") ?? "https://aagsf1.github.io/gratificacoes/";

function response(body: Record<string, unknown>, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

async function authEmailBelongsToAnother(administrator: ReturnType<typeof createClient>, email: string, userId: string) {
  const perPage = 200;
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await administrator.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    if (data.users.some(user => user.id !== userId && user.email?.toLowerCase() === email)) return true;
    if (data.users.length < perPage) return false;
  }
  throw new Error("Não foi possível concluir a verificação de duplicidade do e-mail.");
}

Deno.serve(async request => {
  const origin = request.headers.get("Origin") ?? "";
  const allowedOrigin = new URL(siteUrl).origin;
  if (origin && origin !== allowedOrigin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return response({ error: "Origem não autorizada." }, 403, allowedOrigin);
  }
  const corsOrigin = origin || allowedOrigin;
  if (request.method === "OPTIONS") return response({}, 200, corsOrigin);
  if (request.method !== "POST") return response({ error: "Método não permitido." }, 405, corsOrigin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return response({ error: "Configuração de autenticação indisponível." }, 401, corsOrigin);
  }

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) return response({ error: "Sessão inválida ou expirada." }, 401, corsOrigin);
  const { data: callerProfile, error: callerProfileError } = await caller
    .from("profiles").select("role,ativo").eq("id", authData.user.id).single();
  if (callerProfileError || callerProfile?.role !== "admin" || !callerProfile.ativo) {
    return response({ error: "Somente administradores ativos podem alterar usuários." }, 403, corsOrigin);
  }

  let rawPayload: Record<string, unknown>;
  try { rawPayload = await request.json(); }
  catch { return response({ error: "Dados inválidos." }, 400, corsOrigin); }
  const normalized = normalizeUpdatePayload(rawPayload);
  if (normalized.error || !normalized.value) return response({ error: normalized.error }, 400, corsOrigin);
  const { userId, nome, email, role, ativo } = normalized.value;

  const administrator = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: target, error: targetError } = await administrator
    .from("profiles").select("id,email,nome,role,ativo,created_at,updated_at").eq("id", userId).single();
  if (targetError || !target) return response({ error: "Usuário não encontrado." }, 404, corsOrigin);
  const { data: authTarget, error: authTargetError } = await administrator.auth.admin.getUserById(userId);
  if (authTargetError || !authTarget.user) return response({ error: "Conta de autenticação não encontrada." }, 404, corsOrigin);

  const removesActiveAdmin = target.role === "admin" && target.ativo && (role !== "admin" || !ativo);
  if (removesActiveAdmin) {
    const { count, error: countError } = await administrator
      .from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin").eq("ativo", true);
    if (countError) return response({ error: "Não foi possível validar os administradores ativos." }, 500, corsOrigin);
    if ((count ?? 0) <= 1) return response({ error: "O último administrador ativo não pode ser inativado nem perder o perfil admin." }, 409, corsOrigin);
  }

  const { data: otherProfiles, error: duplicateProfileError } = await administrator
    .from("profiles").select("id,email").neq("id", userId);
  if (duplicateProfileError) return response({ error: "Não foi possível validar a exclusividade do e-mail." }, 500, corsOrigin);
  if (otherProfiles?.some(profile => profile.email?.trim().toLowerCase() === email)) {
    return response({ error: "Este e-mail já pertence a outro usuário." }, 409, corsOrigin);
  }
  try {
    if (await authEmailBelongsToAnother(administrator, email, userId)) {
      return response({ error: "Este e-mail já pertence a outra conta de autenticação." }, 409, corsOrigin);
    }
  } catch {
    return response({ error: "Não foi possível validar a exclusividade do e-mail na autenticação." }, 500, corsOrigin);
  }

  const oldAuthEmail = authTarget.user.email ?? target.email;
  const oldMetadata = authTarget.user.user_metadata ?? {};
  const authChanged = oldAuthEmail.toLowerCase() !== email || oldMetadata.nome !== nome;
  if (authChanged) {
    const { error: authUpdateError } = await administrator.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
      user_metadata: { ...oldMetadata, nome },
    });
    if (authUpdateError) return response({ error: authUpdateError.message }, authUpdateError.status || 400, corsOrigin);
  }

  const { data: updated, error: profileUpdateError } = await administrator
    .from("profiles").update({ nome, email, role, ativo }).eq("id", userId)
    .select("id,email,nome,role,ativo").single();
  if (profileUpdateError || !updated) {
    let restored = true;
    if (authChanged) {
      const { error: rollbackError } = await administrator.auth.admin.updateUserById(userId, {
        email: oldAuthEmail,
        email_confirm: true,
        user_metadata: oldMetadata,
      });
      restored = !rollbackError;
    }
    return response({
      error: restored
        ? "A alteração não foi concluída; os dados de autenticação foram restaurados."
        : "A alteração do perfil falhou e a autenticação não pôde ser restaurada automaticamente. Consulte os logs da função antes de tentar novamente.",
    }, 500, corsOrigin);
  }

  const oldData = { id: target.id, email: target.email, nome: target.nome, role: target.role, ativo: target.ativo };
  const { error: auditError } = await administrator.from("audit_logs").insert({
    actor_id: authData.user.id,
    actor_email: authData.user.email ?? "administrador",
    operation: "UPDATE_USER",
    entity: "auth.users/profiles",
    record_id: userId,
    old_data: oldData,
    new_data: updated,
  });

  return response({
    user: updated,
    emailConfirmedImmediately: true,
    ...(auditError ? { warning: "Usuário atualizado, mas o registro adicional de auditoria falhou." } : {}),
  }, 200, corsOrigin);
});
