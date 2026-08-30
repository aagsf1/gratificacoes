import { createClient } from "npm:@supabase/supabase-js@2";

const allowedRoles = new Set(["admin", "gestor", "consulta"]);
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

  const { data: profile, error: profileError } = await caller
    .from("profiles")
    .select("role,ativo")
    .eq("id", authData.user.id)
    .single();
  if (profileError || profile?.role !== "admin" || !profile.ativo) {
    return response({ error: "Somente administradores podem cadastrar usuários." }, 403, corsOrigin);
  }

  let payload: { nome?: string; email?: string; role?: string };
  try { payload = await request.json(); }
  catch { return response({ error: "Dados inválidos." }, 400, corsOrigin); }
  const nome = payload.nome?.trim();
  const email = payload.email?.trim().toLowerCase();
  const role = payload.role?.trim();
  if (!nome || !email || !role || !allowedRoles.has(role) || !/^\S+@\S+\.\S+$/.test(email)) {
    return response({ error: "Informe nome, e-mail e perfil válidos." }, 400, corsOrigin);
  }

  const administrator = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: invitation, error: invitationError } = await administrator.auth.admin.inviteUserByEmail(email, {
    redirectTo: siteUrl,
    data: { nome },
  });
  if (invitationError) return response({ error: invitationError.message }, invitationError.status || 400, corsOrigin);

  const { error: updateError } = await caller
    .from("profiles")
    .update({ nome, role, ativo: true })
    .eq("id", invitation.user.id);
  if (updateError) return response({ error: "Convite enviado, mas não foi possível atribuir o perfil." }, 500, corsOrigin);

  return response({ user: { id: invitation.user.id, email, nome, role } }, 201, corsOrigin);
});
