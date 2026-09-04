import { createClient } from "npm:@supabase/supabase-js@2";

function response(body: Record<string, unknown>, status: number, origin: string) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": origin, "Vary": "Origin" } });
}

Deno.serve(async request => {
  const origin = request.headers.get("Origin") ?? "https://aagsf1.github.io";
  if (request.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return response({ error: "Sessão ausente." }, 401, origin);
  const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) return response({ error: "Sessão inválida ou expirada." }, 401, origin);
  const { data: profile, error: profileError } = await client.from("profiles").select("role,ativo").eq("id", authData.user.id).single();
  if (profileError || profile?.role !== "admin" || !profile.ativo) return response({ error: "Somente administradores ativos podem usar backup e recuperação." }, 403, origin);
  let payload: { action?: string; includeAudit?: boolean; backup?: unknown; competence?: string; sourceScenarioId?: string };
  try { payload = await request.json(); } catch { return response({ error: "Corpo da solicitação inválido." }, 400, origin); }
  if (payload.action === "export") {
    const { data, error } = await client.rpc("export_operational_backup", { p_include_audit: Boolean(payload.includeAudit) });
    return error ? response({ error: error.message }, 400, origin) : response({ data }, 200, origin);
  }
  if (payload.action === "restore") {
    if (!payload.backup || !/^\d{4}-\d{2}$/.test(String(payload.competence || "")) || typeof payload.sourceScenarioId !== "string") return response({ error: "Dados de restauração inválidos." }, 400, origin);
    const { data, error } = await client.rpc("restore_backup_as_new_competence", { p_backup: payload.backup, p_competencia: `${payload.competence}-01`, p_backup_id: payload.sourceScenarioId });
    return error ? response({ error: error.message }, 400, origin) : response({ data }, 200, origin);
  }
  return response({ error: "Ação de backup inválida." }, 400, origin);
});
