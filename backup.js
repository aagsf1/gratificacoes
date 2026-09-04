const BACKUP_FORMAT = "gratificacoes-backup/v1";
const CODES = new Set(["CJ-01", "CJ-02", "CJ-03", "CJ-04"]);

const asArray = value => Array.isArray(value) ? value : [];
const isUuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const month = value => typeof value === "string" && /^\d{4}-\d{2}-01(?:T00:00:00(?:\.000)?Z)?$/.test(value);
const decimal = value => Number.isFinite(Number(value)) && Number(value) >= 0;

function duplicates(values) {
  const seen = new Set();
  return values.some(value => seen.has(value) || !seen.add(value));
}

export function validateBackup(value) {
  const errors = [];
  const warnings = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, errors: ["O arquivo não contém um objeto JSON de backup."], warnings: [], summary: null };
  if (value.format !== BACKUP_FORMAT) errors.push("Formato de backup incompatível.");
  const data = value.data;
  if (!data || typeof data !== "object") errors.push("O backup não contém os dados operacionais.");
  const tipos = asArray(data?.tipos);
  const cenarios = asArray(data?.cenarios);
  const referencias = asArray(data?.referencias);
  const gratificacoes = asArray(data?.gratificacoes);
  const audit = asArray(data?.auditoria);
  if (tipos.length !== 4 || new Set(tipos.map(row => row.codigo)).size !== 4 || tipos.some(row => !CODES.has(row.codigo))) errors.push("O backup deve conter exatamente CJ-01, CJ-02, CJ-03 e CJ-04.");
  if (!cenarios.length) errors.push("O backup não contém competências.");
  if (cenarios.some(row => !isUuid(row.id) || !month(String(row.competencia || "")) || !decimal(row.orcamento_paradigma))) errors.push("Há competência com identificador, mês ou orçamento inválido.");
  if (duplicates(cenarios.map(row => row.id)) || duplicates(cenarios.map(row => String(row.competencia).slice(0, 7)))) errors.push("Há competências duplicadas no backup.");
  const scenarioIds = new Set(cenarios.map(row => row.id));
  if (referencias.some(row => !scenarioIds.has(row.cenario_id) || !CODES.has(row.codigo) || !decimal(row.valor_integral) || !decimal(row.valor_com_vinculo) || Number(row.percentual_com_vinculo) < 0 || Number(row.percentual_com_vinculo) > 1)) errors.push("Há referências financeiras inválidas ou sem competência correspondente.");
  if (duplicates(referencias.map(row => `${row.cenario_id}/${row.codigo}`))) errors.push("Há referências financeiras duplicadas para a mesma competência e CJ.");
  for (const scenarioId of scenarioIds) if (referencias.filter(row => row.cenario_id === scenarioId).length !== 4) errors.push("Cada competência deve possuir quatro referências financeiras.");
  if (gratificacoes.some(row => !scenarioIds.has(row.cenario_id) || !CODES.has(row.codigo) || !isUuid(row.lineage_id) || typeof row.com_vinculo !== "boolean" || !["ANTIGA", "NOVA", "ALTERADA", "EXTINTA", "FUTURO", "-"].includes(row.situacao))) errors.push("Há gratificação inválida ou sem relação válida no backup.");
  if (duplicates(gratificacoes.map(row => `${row.cenario_id}/${row.lineage_id}`))) errors.push("Há identidades históricas duplicadas na mesma competência.");
  const summary = value.summary || {};
  if (Number(summary.gratificacoes) !== gratificacoes.length || Number(summary.cenarios) !== cenarios.length || Number(summary.referencias) !== referencias.length) errors.push("Os totais declarados no backup não conferem com os dados.");
  if (!value.integrity?.sha256) warnings.push("O backup não possui impressão de integridade SHA-256.");
  if (audit.length) warnings.push("O arquivo inclui registros de auditoria, que são informativos e não serão restaurados.");
  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], summary: { format: value.format, generatedAt: value.generated_at, cenarios, gratificacoes: gratificacoes.length, referencias: referencias.length, auditoria: audit.length } };
}

export function downloadBackup(backup) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `gratificacoes-backup-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export { BACKUP_FORMAT };
