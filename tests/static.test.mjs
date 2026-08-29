import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(resolve(root, "index.html"), "utf8");
const refs = [...html.matchAll(/(?:src|href)="(\.\/[^"?#]+)"/g)].map(match => match[1]);
for (const ref of refs) await access(resolve(root, ref.slice(2)));
const all = await Promise.all(["index.html","app.js","auth.js","data-service.js","supabase-client.js","app-config.js","styles.css","supabase-setup.sql","supabase-seed.sql",".nojekyll",".github/workflows/pages.yml"].map(file => readFile(resolve(root,file),"utf8")));
const combined = all.join("\n");
assert.doesNotMatch(combined, /service_role/i);
assert.doesNotMatch(combined, /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/);
assert.match(await readFile(resolve(root,".github/workflows/pages.yml"),"utf8"), /actions\/deploy-pages@v4/);
console.log(`Referências estáticas validadas: ${refs.join(", ")}.`);
