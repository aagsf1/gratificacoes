import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migration = await readFile(resolve(root, "supabase-maintenance-heartbeat-migration.sql"), "utf8");
const functionSource = await readFile(resolve(root, "supabase/functions/maintenance-heartbeat/index.ts"), "utf8");
const workflow = await readFile(resolve(root, ".github/workflows/supabase-heartbeat.yml"), "utf8");

assert.match(migration, /create schema if not exists maintenance/, "A escrita técnica deve ficar em schema isolado");
assert.match(migration, /enable row level security/, "A tabela técnica deve manter RLS habilitado");
assert.match(migration, /interval '24 hours'/, "A rotina deve impedir repetição prematura");
assert.match(migration, /public\.run_maintenance_heartbeat[\s\S]*grant execute on function public\.run_maintenance_heartbeat\(text\) to service_role/, "A chamada exposta deve ser exclusiva da função do servidor");
assert.match(migration, /select count\(\*\).*public\.cenarios[\s\S]*select count\(\*\).*public\.tipos_gratificacao[\s\S]*select count\(\*\).*public\.referencias_financeiras/, "A rotina deve fazer somente leituras agregadas das tabelas operacionais");
assert.doesNotMatch(migration, /(?:insert into|update|delete from)\s+public\.(?:cenarios|gratificacoes|referencias_financeiras|profiles|audit_logs)/i, "A rotina não pode escrever em dados operacionais");
assert.match(functionSource, /request\.method !== "POST"/, "A função deve aceitar somente POST");
assert.match(functionSource, /x-heartbeat-secret/, "A função deve exigir segredo próprio");
assert.match(functionSource, /SUPABASE_SERVICE_ROLE_KEY[\s\S]*run_maintenance_heartbeat/, "A função deve usar privilégio somente no servidor");
assert.match(workflow, /cron: "17 3 \*\/2 \* \*"/, "O workflow deve executar no máximo a cada 48 horas");
assert.match(workflow, /SUPABASE_HEARTBEAT_SECRET/, "O workflow deve usar segredo do GitHub");
