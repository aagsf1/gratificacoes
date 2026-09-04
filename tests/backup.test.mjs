import assert from "node:assert/strict";
import { validateBackup } from "../backup.js";

const id = "11111111-1111-4111-8111-111111111111";
const lineage = "22222222-2222-4222-8222-222222222222";
const codes = ["CJ-01", "CJ-02", "CJ-03", "CJ-04"];
const backup = {
  format: "gratificacoes-backup/v1", generated_at: "2026-09-04T00:00:00Z", integrity: { sha256: "a".repeat(64) },
  data: { tipos: codes.map(codigo => ({ codigo })), cenarios: [{ id, competencia: "2026-08-01", orcamento_paradigma: 1 }], referencias: codes.map(codigo => ({ cenario_id: id, codigo, valor_integral: 1, percentual_com_vinculo: .65, valor_com_vinculo: .65 })), gratificacoes: [{ cenario_id: id, lineage_id: lineage, codigo: "CJ-01", com_vinculo: true, situacao: "NOVA" }], auditoria: [] },
  summary: { cenarios: 1, referencias: 4, gratificacoes: 1 },
};
assert.equal(validateBackup(backup).valid, true, "backup íntegro deve ser aceito");
assert.equal(validateBackup({ ...backup, data: { ...backup.data, tipos: backup.data.tipos.slice(1) } }).valid, false, "tipos incompletos devem ser rejeitados");
assert.equal(validateBackup({ ...backup, summary: { ...backup.summary, gratificacoes: 99 } }).valid, false, "totais divergentes devem ser rejeitados");
