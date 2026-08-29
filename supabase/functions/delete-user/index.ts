import { createClient } from "npm:@supabase/supabase-js@2";

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
    .from("profiles")
    .select("role,ativo")
    .eq("id", authData.user.id)
    .single();
  if (callerProfileError || callerProfile?.role !== "admin" || !callerProfile.ativo) {
    return response({ error: "Somente administradores podem excluir usuários." }, 403, corsOrigin);
  }

  let payload: { userId?: string };
  try { payload = await request.json(); }
  catch { return response({ error: "Dados inválidos." }, 400, corsOrigin); }
  const userId = payload.userId?.trim();
  if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return response({ error: "Identificador de usuário inválido." }, 400, corsOrigin);
  }
  if (userId === authData.user.id) {
    return response({ error: "Você não pode excluir sua própria conta." }, 409, corsOrigin);
  }

  const administrator = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: target, error: targetError } = await administrator
    .from("profiles")
    .select("id,email,nome,role,ativo,created_at,updated_at")
    .eq("id", userId)
    .single();
  if (targetError || !target) return response({ error: "Usuário não encontrado." }, 404, corsOrigin);

  if (target.role === "admin" && target.ativo) {
    const { count, error: countError } = await administrator
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("ativo", true);
    if (countError) return response({ error: "Não foi possível validar os administradores ativos." }, 500, corsOrigin);
    if ((count ?? 0) <= 1) return response({ error: "O último administrador ativo não pode ser excluído." }, 409, corsOrigin);
  }

  const { error: deleteError } = await administrator.auth.admin.deleteUser(userId, false);
  if (deleteError) return response({ error: deleteError.message }, deleteError.status || 400, corsOrigin);

  const { error: auditError } = await administrator.from("audit_logs").insert({
    actor_id: authData.user.id,
    actor_email: authData.user.email ?? "administrador",
    operation: "DELETE",
    entity: "auth.users",
    record_id: userId,
    old_data: target,
    new_data: null,
  });

  return response({
    deleted: { id: userId, email: target.email },
    ...(auditError ? { warning: "Usuário excluído, mas o registro de auditoria falhou." } : {}),
  }, 200, corsOrigin);
});
