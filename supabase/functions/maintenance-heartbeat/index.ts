import { createClient } from "npm:@supabase/supabase-js@2";

function reply(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function authorized(received: string | null, expected: string | undefined) {
  if (!received || !expected || received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < received.length; index += 1) difference |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

Deno.serve(async request => {
  if (request.method !== "POST") return reply({ error: "Método não permitido." }, 405);
  if (!authorized(request.headers.get("x-heartbeat-secret"), Deno.env.get("MAINTENANCE_HEARTBEAT_SECRET"))) {
    return reply({ error: "Não autorizado." }, 401);
  }

  const client = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await client.rpc("run_maintenance_heartbeat", { p_routine_version: "v1" });
  if (error) {
    const repeated = error.message.includes("últimas 24 horas");
    return reply({ error: repeated ? "A rotina já foi executada recentemente." : "Falha na rotina técnica." }, repeated ? 429 : 500);
  }
  return reply({ ok: true, executedAt: data?.executed_at ?? null }, 200);
});
