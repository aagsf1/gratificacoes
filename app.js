import { isConfigured } from "./app-config.js?v=20260829-admin";
import { currentIdentity, onAuthStateChange, requestPasswordReset, signIn, signOut, updatePassword, verifyAccessCode } from "./auth.js?v=20260829-admin";
import { changeCompetenceStatus, clearAuditLogs, deleteGrant, deleteUser, exportOperationalBackup, inactivateGrant, inviteUser, loadApplicationData, restoreBackupAsNewCompetence, saveFinancialReferences, saveGrant, updateUser } from "./data-service.js?v=20260904-backup-v1";
import { decimal4, fromDecimal4, linkedValueFromPercent, summarize, summarizeCsjtPrevious } from "./calc.js?v=20260831-csjt-fixed-v1";
import { startPresence, stopPresence, updatePresence } from "./presence.js?v=20260829-presence-v3";
import { downloadBackup, validateBackup } from "./backup.js?v=20260904-backup-v1";

const state = { identity: null, data: null, summary: null, onlineUsers: [], presenceStatus: "connecting", scenarioId: null, referenceScenarioId: null, csjtScenarioId: null };
const GRANT_SORT_FIELDS = Object.freeze({
  tipo_codigo: "Tipo",
  servidor_nome: "Servidor",
  unidade_nome: "Unidade",
  unidade_sigla: "Sigla",
  com_vinculo: "Vínculo",
  situacao: "Situação",
});
let grantSort = { key: "tipo_codigo", direction: "asc" };
let validatedBackup = null;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const money = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const percentage = value => `${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const dateTime = value => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "—";
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const canWrite = () => ["admin", "gestor"].includes(state.identity?.profile.role);
const REPORT_FIELDS = [
  { key: "id", label: "ID" },
  { key: "competencia", label: "Competência", groupable: true, format: row => scenarioCompetence(row) },
  { key: "lineage_id", label: "Identidade histórica" },
  { key: "tipo_codigo", label: "Gratificação", groupable: true },
  { key: "unidade_nome", label: "Unidade", groupable: true },
  { key: "servidor_nome", label: "Servidor" },
  { key: "com_vinculo", label: "Vínculo", groupable: true, format: row => row.com_vinculo ? "Com vínculo" : "Sem vínculo" },
  { key: "situacao", label: "Situação", groupable: true },
  { key: "unidade_sigla", label: "Sigla", groupable: true },
  { key: "valor_integral", label: "Valor integral", numeric: true, format: row => money(Number(row.valor_integral)) },
  { key: "percentual_aplicado", label: "% aplicado", numeric: true, format: row => percentage(row.com_vinculo ? Number(row.percentual_com_vinculo) * 100 : 100) },
  { key: "valor_pago", label: "Valor pago", numeric: true, format: row => money(Number(row.valor_pago)) },
  { key: "observacoes", label: "Observações" },
  { key: "ativo", label: "Status", groupable: true, format: row => row.ativo ? "Ativa" : "Inativa" },
];
const REPORT_STORAGE = "gratificacoes_report_config_v2";
const DEFAULT_REPORT_CONFIG = Object.freeze({
  title: "Relatório customizado de gratificações",
  fields: ["tipo_codigo", "unidade_sigla", "unidade_nome", "servidor_nome", "com_vinculo", "situacao", "valor_integral", "valor_pago"],
  search: "", scenario: "", compareScenario: "", type: "", link: "", situation: "", unit: "", active: "", group: "", order: "unidade_sigla", direction: "asc",
});
function loadReportConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(REPORT_STORAGE) || "{}");
    const keys = new Set(REPORT_FIELDS.map(field => field.key));
    const groupKeys = new Set(REPORT_FIELDS.filter(field => field.groupable).map(field => field.key));
    const config = { ...DEFAULT_REPORT_CONFIG, ...saved };
    config.fields = (Array.isArray(saved.fields) ? saved.fields : DEFAULT_REPORT_CONFIG.fields).filter(key => keys.has(key));
    if (!groupKeys.has(config.group)) config.group = "";
    if (!keys.has(config.order)) config.order = DEFAULT_REPORT_CONFIG.order;
    if (!['asc', 'desc'].includes(config.direction)) config.direction = "asc";
    return config;
  } catch { return { ...DEFAULT_REPORT_CONFIG, fields: [...DEFAULT_REPORT_CONFIG.fields] }; }
}
let reportConfig = loadReportConfig();
let reportView = "custom";
const authRedirect = new URLSearchParams(window.location.hash.slice(1));
const authQuery = new URLSearchParams(window.location.search);
let passwordRecoveryPending = ["recovery", "invite"].includes(authRedirect.get("type"));
let accessCodeType = authQuery.get("invite") === "1" ? "invite" : "recovery";
let recoveryCodePending = authQuery.get("recovery") === "1" || authQuery.get("invite") === "1";

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.style.background = error ? "#FFCD00" : "#01426A";
  element.style.color = error ? "#01426A" : "white";
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 3500);
}

function showAuthMessage(message) {
  const element = $("#auth-message");
  element.textContent = message;
  element.hidden = false;
}

function clearAuthRedirect(clearQuery = false) {
  history.replaceState(null, "", clearQuery ? window.location.pathname : `${window.location.pathname}${window.location.search}`);
}

function handleAuthRedirectError() {
  if (!authRedirect.has("error")) return false;
  const code = authRedirect.get("error_code");
  const message = code === "otp_expired"
    ? "Este link expirou ou já foi utilizado. No primeiro acesso, use o código do convite; na recuperação, solicite um novo código."
    : "Não foi possível validar o link de autenticação. Solicite um novo link e tente novamente.";
  showAuthMessage(message);
  clearAuthRedirect();
  return true;
}

function showPasswordRecovery() {
  passwordRecoveryPending = true;
  recoveryCodePending = false;
  $("#login-view").hidden = true;
  $("#recovery-code-view").hidden = true;
  $("#app-view").hidden = true;
  $("#password-recovery-view").hidden = false;
  $("#new-password").focus();
}

function showRecoveryCode(email = "", type = accessCodeType) {
  accessCodeType = type === "invite" ? "invite" : "recovery";
  recoveryCodePending = true;
  $("#login-view").hidden = true;
  $("#password-recovery-view").hidden = true;
  $("#app-view").hidden = true;
  $("#recovery-code-view").hidden = false;
  const firstAccess = accessCodeType === "invite";
  $("#access-code-eyebrow").textContent = firstAccess ? "Primeiro acesso" : "Recuperação de acesso";
  $("#access-code-title").textContent = firstAccess ? "Cadastre sua primeira senha" : "Confirme o código";
  $("#access-code-description").textContent = firstAccess
    ? "Informe seu e-mail e o código recebido no convite. Depois da confirmação, você criará sua própria senha."
    : "Digite o código de recuperação recebido por e-mail. Ele só será utilizado quando você confirmar este formulário.";
  $("#recovery-email").value = email;
  (email ? $("#recovery-code") : $("#recovery-email")).focus();
}

function showLogin() {
  passwordRecoveryPending = false;
  recoveryCodePending = false;
  clearAuthRedirect(true);
  $("#recovery-code-view").hidden = true;
  $("#password-recovery-view").hidden = true;
  $("#app-view").hidden = true;
  $("#login-view").hidden = false;
  $("#email").focus();
}

const SCENARIO_LABELS = { RASCUNHO: "Rascunho", VIGENTE: "Vigente", APROVADO: "Encerrada", ARQUIVADO: "Arquivada", "EM ANÁLISE": "Em análise" };
function vigenteScenario() { return state.data.cenarios.find(item => item.status === "VIGENTE") ?? state.data.cenarios[0]; }
function currentScenario() { return state.data.cenarios.find(item => item.id === state.scenarioId) ?? vigenteScenario(); }
function grantsForScenario(scenarioId, includeInactive = false) {
  return state.data.gratificacoesTodas.filter(row => row.cenario_id === scenarioId && (includeInactive || row.ativo));
}
function currentGrants(includeInactive = false) { return grantsForScenario(currentScenario()?.id, includeInactive); }
function canEditScenario(scenario = currentScenario()) { return canWrite() && ["RASCUNHO","VIGENTE"].includes(scenario?.status); }
function scenarioTypes(scenarioId) {
  const references = state.data.referencias.filter(row => row.cenario_id === scenarioId);
  if (references.length) return references.map(row => ({ ...row, id: row.tipo_id }));
  const rows = grantsForScenario(scenarioId, true);
  return state.data.tipos.map(type => {
    const sample = rows.find(row => row.tipo_id === type.id);
    return sample ? { ...type, valor_integral: sample.valor_integral, percentual_com_vinculo: sample.percentual_com_vinculo, valor_com_vinculo: sample.valor_com_vinculo } : type;
  });
}

function refreshSummary() {
  const scenario = currentScenario();
  state.summary = summarize(currentGrants(), scenarioTypes(scenario?.id), scenario?.orcamento_paradigma ?? 0);
}

function renderCards() {
  const t = state.summary.totals;
  const cards = [
    ["Orçamento paradigma", money(fromDecimal4(t.budget4))],
    ["Total pago", money(fromDecimal4(t.paid4))],
    ["Saldo", money(fromDecimal4(t.balance4)), t.balance4 >= 0n ? "good" : "warn"],
    ["Execução", percentage(t.execution * 100), t.execution > 1 ? "warn" : ""],
    ["Gratificações", t.count], ["Com vínculo", t.linked], ["Sem vínculo", t.unlinked],
    ["Proporção com vínculo", percentage(t.count ? t.linked / t.count * 100 : 0)],
  ];
  $("#cards").innerHTML = cards.map(([label, value, className = ""]) => `<article class="card ${className}"><small>${label}</small><strong>${value}</strong></article>`).join("");
}

function renderSummary() {
  const max = Math.max(...state.summary.rows.map(row => row.count), 1);
  $("#type-bars").innerHTML = state.summary.rows.map(row => `<div class="bar-row"><strong>${row.codigo}</strong><div class="bar"><span style="width:${row.count / max * 100}%"></span></div><span>${row.count}</span></div>`).join("");
  $("#summary-table").innerHTML = `<thead><tr><th>Tipo</th><th class="number">Com vínculo</th><th class="number">Sem vínculo</th><th class="number">Total</th><th class="number">Valor pago</th></tr></thead><tbody>${state.summary.rows.map(row => `<tr><td>${row.codigo}</td><td class="number">${row.linked}</td><td class="number">${row.unlinked}</td><td class="number">${row.count}</td><td class="number">${money(fromDecimal4(row.paid4))}</td></tr>`).join("")}</tbody><tfoot><tr><th colspan="4">Total pago</th><td class="number">${money(fromDecimal4(state.summary.totals.paid4))}</td></tr></tfoot>`;
}

function filteredGrants() {
  const query = $("#search").value.trim().toLocaleLowerCase("pt-BR");
  const type = $("#filter-type").value;
  const link = $("#filter-link").value;
  const rows = currentGrants().filter(row => {
    const haystack = `${row.servidor_nome} ${row.unidade_nome} ${row.unidade_sigla}`.toLocaleLowerCase("pt-BR");
    return (!query || haystack.includes(query)) && (!type || row.tipo_codigo === type) && (!link || String(row.com_vinculo) === link);
  });
  const valueForSort = row => grantSort.key === "com_vinculo" ? (row.com_vinculo ? "Com vínculo" : "Sem vínculo") : String(row[grantSort.key] || "");
  return rows.sort((left, right) => valueForSort(left).localeCompare(valueForSort(right), "pt-BR", { numeric: true, sensitivity: "base" }) * (grantSort.direction === "asc" ? 1 : -1));
}

function renderGrants() {
  const rows = filteredGrants();
  const sortableHeader = key => {
    const active = grantSort.key === key;
    const direction = grantSort.direction === "asc" ? "crescente" : "decrescente";
    const indicator = active ? (grantSort.direction === "asc" ? " ▲" : " ▼") : "";
    return `<th aria-sort="${active ? grantSort.direction === "asc" ? "ascending" : "descending" : "none"}"><button class="sort-button" data-sort-grants="${key}" aria-label="Classificar por ${GRANT_SORT_FIELDS[key]}${active ? `, ordem ${direction}` : ""}">${GRANT_SORT_FIELDS[key]}<span aria-hidden="true">${indicator}</span></button></th>`;
  };
  $("#grants-table").innerHTML = `<thead><tr>${Object.keys(GRANT_SORT_FIELDS).map(sortableHeader).join("")}<th class="number">Valor pago</th>${canEditScenario() ? "<th>Ações</th>" : ""}</tr></thead><tbody>${rows.map(row => `<tr><td>${row.tipo_codigo}</td><td>${escapeHtml(row.servidor_nome || "—")}</td><td>${escapeHtml(row.unidade_nome)}</td><td>${escapeHtml(row.unidade_sigla)}</td><td>${row.com_vinculo ? "Sim" : "Não"}</td><td>${escapeHtml(row.situacao)}</td><td class="number">${money(Number(row.valor_pago))}</td>${canEditScenario() ? `<td class="row-actions"><button data-edit="${row.id}">Editar</button><button class="secondary" data-delete="${row.id}" data-version="${row.lock_version}">Inativar</button><button class="danger" data-remove-grant="${row.id}" data-version="${row.lock_version}">Excluir</button></td>` : ""}</tr>`).join("")}</tbody>`;
}

function csjtValues(summary, types) {
  return summary.rows.map(row => {
    const type = types.find(item => item.codigo === row.codigo);
    const unlinkedPaid4 = decimal4(type.valor_integral) * BigInt(row.unlinked);
    return { row, linkedPaid4: row.paid4 - unlinkedPaid4, unlinkedPaid4 };
  });
}

function csjtLine({ row, linkedPaid4, unlinkedPaid4 }) {
  return `<div class="csjt-row"><div class="csjt-cell green cargo">${row.codigo.replace("CJ-0", "CJ-")}</div><div class="csjt-cell blue">${row.linked}</div><div class="csjt-cell blue money">${money(fromDecimal4(linkedPaid4))}</div><div class="csjt-cell yellow">${row.unlinked}</div><div class="csjt-cell yellow money">${money(fromDecimal4(unlinkedPaid4))}</div><div class="csjt-cell green">${row.count}</div><div class="csjt-cell green money">${money(fromDecimal4(row.paid4))}</div></div>`;
}

function csjtSection(title, summary, types, current = false) {
  const values = csjtValues(summary, types);
  const linkedPaid4 = values.reduce((sum, item) => sum + item.linkedPaid4, 0n);
  const unlinkedPaid4 = values.reduce((sum, item) => sum + item.unlinkedPaid4, 0n);
  const t = summary.totals;
  const ratio = value => percentage(t.count ? value / t.count * 100 : 0);
  const total = `<div class="csjt-row csjt-total"><div class="csjt-cell green cargo">Total</div><div class="csjt-cell blue">${t.linked}</div><div class="csjt-cell blue money">${money(fromDecimal4(linkedPaid4))}</div><div class="csjt-cell yellow">${t.unlinked}</div><div class="csjt-cell yellow money">${money(fromDecimal4(unlinkedPaid4))}</div><div class="csjt-cell green">${t.count}</div><div class="csjt-cell green money">${money(fromDecimal4(t.paid4))}</div></div>`;
  return `<section class="csjt-section ${current ? "proposed" : ""}"><div class="csjt-big-title">${title}</div><div class="csjt-head"><div>Cargo</div><div>Qtd. efetivos</div><div>Valor efetivos</div><div>Qtd. sem vínculo</div><div>Valor sem Vínculo</div><div>Qtd. Total</div><div>Valor Total</div></div><div class="csjt-lines">${values.map(csjtLine).join("")}${total}</div><div class="csjt-bottom"><div class="csjt-info"><div class="info-title">${current ? "Orçamento paradigma (100%) - Situação Anterior" : "Orçamento paradigma (100%)"}</div><div class="info-note">Todas as CJs são calculadas como 100%</div><div class="info-value">${money(fromDecimal4(t.budget4))}</div></div><div class="csjt-info"><div class="info-title proportion-title">${current ? "Proporção de distribuição entre<br>efetivos X sem vínculo" : "Proporção de distribuição efetivo X sem vínculo"}</div><div class="info-note blank">&nbsp;</div><div class="info-value proportion"><span>${ratio(t.linked)}</span><b>X</b><span>${ratio(t.unlinked)}</span></div></div><div class="csjt-info"><div class="info-title">${current ? "Sobra orçamentária atual" : "Valor Residual Limite"}</div><div class="info-note">${current ? "Diferença entre o orçamento paradigma e o valor total pago" : "Diferença entre o orçamento paradigma e as CJs 65%"}</div><div class="info-value ${t.balance4 < 0n ? "negative" : ""}">${money(fromDecimal4(t.balance4))}</div></div></div></section>`;
}

function scenarioCompetence(scenario = currentScenario()) {
  const value = scenario?.competencia;
  const match = String(value || "").match(/^(\d{4})-(\d{2})/);
  return match ? `${match[2]}/${match[1]}` : "não informada";
}

function scenarioDisplayName(scenario) {
  return `${scenarioCompetence(scenario)} — ${scenario?.status === "VIGENTE" ? "Vigente" : "Histórica"}`;
}

function scenarioDisplayStatus(scenario) {
  return scenario?.status === "VIGENTE" ? "Vigente" : "Histórica";
}

function renderCsjt() {
  const scenarios = state.data.cenarios;
  const fallback = currentScenario();
  const selected = scenarios.find(row => row.id === state.csjtScenarioId) ?? fallback;
  const previous = selected;
  const current = selected;
  state.csjtScenarioId = selected?.id ?? null;
  $("#csjt-reference").value = state.csjtScenarioId ?? "";
  const previousTypes = scenarioTypes(previous?.id);
  const currentTypes = scenarioTypes(current?.id);
  const previousSummary = summarizeCsjtPrevious(previousTypes, previous?.orcamento_paradigma ?? 0);
  const currentSummary = summarize(grantsForScenario(current?.id), currentTypes, current?.orcamento_paradigma ?? 0);
  const warning = $("#csjt-history-warning");
  warning.hidden = true;
  warning.textContent = "";
  $("#csjt-competence").textContent = `As duas tabelas representam a competência ${scenarioCompetence(selected)}`;
  $("#csjt-sheet").innerHTML = `${csjtSection("Situação Anterior (30/06/2022)", previousSummary, previousTypes)}${csjtSection(`Situação Posterior (${scenarioCompetence(current)})`, currentSummary, currentTypes, true)}`;
}

function saveReportConfig() { try { localStorage.setItem(REPORT_STORAGE, JSON.stringify(reportConfig)); } catch { /* Preferências locais são opcionais. */ } }

function selectedReportFields() {
  const selected = new Set(reportConfig.fields);
  return REPORT_FIELDS.filter(field => selected.has(field.key));
}

function readReportConfig() {
  reportConfig = {
    title: $("#report-title").value.trim() || DEFAULT_REPORT_CONFIG.title,
    fields: $$("#report-field-options input:checked").map(input => input.value),
    search: $("#report-search").value,
    scenario: $("#report-scenario").value,
    compareScenario: $("#report-compare-scenario").value,
    type: $("#report-type").value,
    link: $("#report-link").value,
    situation: $("#report-situation").value,
    unit: $("#report-unit").value,
    active: $("#report-active").value,
    group: $("#report-group").value,
    order: $("#report-order").value,
    direction: $("#report-direction").value,
  };
  saveReportConfig();
}

function applyReportConfig() {
  $("#report-title").value = reportConfig.title;
  $("#report-search").value = reportConfig.search;
  $("#report-scenario").value = reportConfig.scenario || currentScenario()?.id || "";
  $("#report-compare-scenario").value = reportConfig.compareScenario || "";
  $("#report-type").value = reportConfig.type;
  $("#report-link").value = reportConfig.link;
  $("#report-situation").value = reportConfig.situation;
  $("#report-unit").value = reportConfig.unit;
  $("#report-active").value = reportConfig.active;
  $("#report-group").value = reportConfig.group;
  $("#report-order").value = reportConfig.order;
  $("#report-direction").value = reportConfig.direction;
  $$("#report-field-options input").forEach(input => { input.checked = reportConfig.fields.includes(input.value); });
}

function reportRows() {
  const query = reportConfig.search.trim().toLocaleLowerCase("pt-BR");
  const selectedScenarioId = reportConfig.scenario || currentScenario()?.id;
  const rows = state.data.gratificacoesTodas.filter(row => {
    const haystack = `${row.id} ${row.servidor_nome ?? ""} ${row.unidade_nome ?? ""} ${row.unidade_sigla ?? ""} ${row.tipo_codigo} ${row.situacao} ${row.observacoes ?? ""}`.toLocaleLowerCase("pt-BR");
    return row.cenario_id === selectedScenarioId
      && (!reportConfig.type || row.tipo_codigo === reportConfig.type)
      && (!reportConfig.situation || row.situacao === reportConfig.situation)
      && (!reportConfig.link || String(row.com_vinculo) === reportConfig.link)
      && (!reportConfig.active || String(row.ativo) === reportConfig.active)
      && (!reportConfig.unit || row.unidade_sigla === reportConfig.unit)
      && (!query || haystack.includes(query));
  });
  const direction = reportConfig.direction === "desc" ? -1 : 1;
  const key = reportConfig.order || DEFAULT_REPORT_CONFIG.order;
  return rows.sort((a, b) => {
    const sortValue = row => key === "percentual_aplicado" ? (row.com_vinculo ? Number(row.percentual_com_vinculo) : 1) : (row[key] ?? "");
    const first = sortValue(a);
    const second = sortValue(b);
    if (["valor_integral", "percentual_aplicado", "valor_pago"].includes(key)) return (Number(first) - Number(second)) * direction;
    return String(first).localeCompare(String(second), "pt-BR", { numeric: true, sensitivity: "base" }) * direction;
  });
}

function reportValue(field, row) {
  return field.format ? field.format(row) : (row[field.key] ?? "—");
}

function comparisonRows() {
  if (!reportConfig.compareScenario || reportConfig.compareScenario === reportConfig.scenario) return [];
  const current = new Map(reportRows().map(row => [row.lineage_id, row]));
  const selected = reportConfig.scenario;
  reportConfig.scenario = reportConfig.compareScenario;
  const previous = new Map(reportRows().map(row => [row.lineage_id, row]));
  reportConfig.scenario = selected;
  const keys = new Set([...current.keys(), ...previous.keys()]);
  return [...keys].map(lineageId => {
    const before = previous.get(lineageId);
    const after = current.get(lineageId);
    if (!before) return { kind: "Incluída", before, after };
    if (!after) return { kind: "Excluída/Inativa", before, after };
    const changed = ["tipo_codigo","unidade_sigla","unidade_nome","servidor_nome","com_vinculo","situacao","valor_pago","ativo"]
      .some(key => String(before[key] ?? "") !== String(after[key] ?? ""));
    return changed ? { kind: "Alterada", before, after } : null;
  }).filter(Boolean);
}

function renderReportComparison() {
  const output = $("#report-comparison");
  if (!reportConfig.compareScenario || reportConfig.compareScenario === reportConfig.scenario) { output.innerHTML = ""; return; }
  const rows = comparisonRows();
  const beforeScenario = state.data.cenarios.find(row => row.id === reportConfig.compareScenario);
  const afterScenario = state.data.cenarios.find(row => row.id === reportConfig.scenario);
  const totals = kind => rows.filter(row => row.kind === kind).length;
  const body = rows.map(change => {
    const before = change.before;
    const after = change.after;
    const record = after || before;
    return `<tr><td><strong>${change.kind}</strong></td><td>${escapeHtml(record?.tipo_codigo || "—")}</td><td>${escapeHtml(record?.servidor_nome || "—")}</td><td>${escapeHtml(before?.unidade_sigla || "—")}</td><td>${escapeHtml(after?.unidade_sigla || "—")}</td><td class="number">${before ? money(Number(before.valor_pago)) : "—"}</td><td class="number">${after ? money(Number(after.valor_pago)) : "—"}</td></tr>`;
  }).join("");
  output.innerHTML = `<section class="panel report-comparison"><div class="section-title"><div><h2>Comparação histórica</h2><p>De ${scenarioCompetence(beforeScenario)} para ${scenarioCompetence(afterScenario)}</p></div><span class="report-badge">${rows.length} alteração(ões)</span></div><div class="comparison-metrics"><span>${totals("Incluída")} incluída(s)</span><span>${totals("Excluída/Inativa")} excluída(s)/inativa(s)</span><span>${totals("Alterada")} alterada(s)</span></div><div class="table-wrap report-table"><table><thead><tr><th>Movimento</th><th>Tipo</th><th>Servidor</th><th>Unidade anterior</th><th>Unidade atual</th><th class="number">Valor anterior</th><th class="number">Valor atual</th></tr></thead><tbody>${body || '<tr><td colspan="7" class="empty-report">Nenhuma diferença encontrada entre as competências selecionadas.</td></tr>'}</tbody></table></div></section>`;
}

function reportTable(rows, fields) {
  const head = fields.map(field => `<th class="${field.numeric ? "number" : ""}">${field.label}</th>`).join("");
  const body = rows.length ? rows.map(row => `<tr>${fields.map(field => `<td class="${field.numeric ? "number" : ""}">${escapeHtml(reportValue(field, row))}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${fields.length}" class="empty-report">Nenhum registro corresponde aos critérios do relatório.</td></tr>`;
  return `<div class="table-wrap report-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function reportResults(rows, fields) {
  if (!fields.length) return `<div class="panel empty-report">Selecione ao menos um campo para montar o relatório.</div>`;
  if (!reportConfig.group) return reportTable(rows, fields);
  const groupField = REPORT_FIELDS.find(field => field.key === reportConfig.group);
  const groups = new Map();
  for (const row of rows) {
    const key = String(reportValue(groupField, row));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([group, records]) => {
    const paid = records.reduce((sum, row) => sum + Number(row.valor_pago || 0), 0);
    return `<section class="report-group"><div class="report-group-head"><div><strong>${groupField.label}: ${escapeHtml(group)}</strong><span>${records.length} registro(s)</span></div><b>${money(paid)}</b></div>${reportTable(records, fields)}</section>`;
  }).join("") || reportTable([], fields);
}

function renderReport() {
  const fields = selectedReportFields();
  const rows = reportRows();
  const totalPaid = rows.reduce((sum, row) => sum + Number(row.valor_pago || 0), 0);
  const totalIntegral = rows.reduce((sum, row) => sum + Number(row.valor_integral || 0), 0);
  const linked = rows.filter(row => row.com_vinculo).length;
  const unlinked = rows.length - linked;
  const reportScenario = state.data.cenarios.find(row => row.id === (reportConfig.scenario || currentScenario()?.id)) ?? currentScenario();
  const budget = Number(reportScenario?.orcamento_paradigma || 0);
  const balance = budget - totalPaid;
  $("#report-status").textContent = `${rows.length} registro${rows.length === 1 ? "" : "s"} selecionado${rows.length === 1 ? "" : "s"}`;
  $("#report-output-title").textContent = reportConfig.title;
  $("#report-generated").textContent = `Competência ${scenarioCompetence(reportScenario)} · Gerado em ${new Date().toLocaleString("pt-BR")}`;
  $("#report-metrics").innerHTML = `<article class="card"><small>Registros</small><strong>${rows.length}</strong><span>${linked} com vínculo · ${unlinked} sem vínculo</span></article><article class="card"><small>Valor pago selecionado</small><strong>${money(totalPaid)}</strong></article><article class="card"><small>Valor integral selecionado</small><strong>${money(totalIntegral)}</strong></article><article class="card"><small>Saldo vs. paradigma</small><strong class="${balance >= 0 ? "report-good" : "report-danger"}">${money(balance)}</strong><span>Paradigma menos itens selecionados</span></article>`;
  renderReportComparison();
  $("#report-results").innerHTML = reportResults(rows, fields);
}

function setReportView(view) {
  reportView = view === "csjt" ? "csjt" : "custom";
  $("#custom-report-view").hidden = reportView !== "custom";
  $("#csjt-report-view").hidden = reportView !== "csjt";
  $("#show-custom-report").classList.toggle("secondary", reportView !== "custom");
  $("#show-csjt-report").classList.toggle("secondary", reportView !== "csjt");
  if (reportView === "csjt") renderCsjt(); else renderReport();
}

function renderAudit() {
  const rows = state.data.auditoria.map(row => `<tr><td>${dateTime(row.created_at)}</td><td>${escapeHtml(row.actor_email || "—")}</td><td>${row.operation}</td><td>${row.entity}</td><td>${row.record_id || "—"}</td><td>${escapeHtml(JSON.stringify(row.old_data) || "—")}</td><td>${escapeHtml(JSON.stringify(row.new_data) || "—")}</td></tr>`).join("");
  $("#audit-table").innerHTML = `<thead><tr><th>Data</th><th>Usuário</th><th>Operação</th><th>Entidade</th><th>Registro</th><th>Antes</th><th>Depois</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty-state">Nenhum registro de auditoria.</td></tr>'}</tbody>`;
}

function renderProfiles() {
  $("#profiles-table").innerHTML = `<thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Ativo</th><th>Ações</th></tr></thead><tbody>${state.data.perfis.map(row => {
    const ownAccount = row.id === state.identity.profile.id;
    return `<tr data-profile="${row.id}"><td><input class="profile-edit-input" data-field="nome" value="${escapeHtml(row.nome || "")}" maxlength="160" required aria-label="Nome de ${escapeHtml(row.email)}"></td><td><input class="profile-edit-input profile-email-input" data-field="email" type="email" value="${escapeHtml(row.email)}" maxlength="254" required aria-label="E-mail de ${escapeHtml(row.nome || row.email)}"></td><td><select data-field="role" aria-label="Perfil de ${escapeHtml(row.nome || row.email)}">${["admin","gestor","consulta"].map(role => `<option value="${role}" ${row.role === role ? "selected" : ""}>${role}</option>`).join("")}</select></td><td><input data-field="ativo" type="checkbox" ${row.ativo ? "checked" : ""} aria-label="Usuário ${escapeHtml(row.nome || row.email)} ativo"></td><td><span class="profile-change-status" hidden>Alterações não salvas</span><div class="row-actions"><button data-save-profile="${row.id}" disabled>Salvar</button><button class="danger" data-delete-profile="${row.id}" ${ownAccount ? 'disabled title="Sua própria conta não pode ser excluída"' : ""}>Excluir</button></div></td></tr>`;
  }).join("")}</tbody>`;
}

function renderBackupValidation() {
  const output = $("#backup-validation");
  const source = $("#backup-source-scenario");
  const restore = $("#restore-backup");
  if (!validatedBackup) {
    output.textContent = "Selecione um arquivo JSON para validar antes de restaurar.";
    source.innerHTML = "";
    restore.disabled = true;
    return;
  }
  const { result, backup } = validatedBackup;
  const lines = [
    `Formato: ${result.summary?.format || "inválido"}`,
    `Gerado em: ${result.summary?.generatedAt ? dateTime(result.summary.generatedAt) : "não informado"}`,
    `Competências: ${result.summary?.cenarios.length || 0}`,
    `Gratificações: ${result.summary?.gratificacoes || 0}`,
    `Referências financeiras: ${result.summary?.referencias || 0}`,
    `Auditoria incluída: ${result.summary?.auditoria || 0}`,
    ...result.errors.map(message => `Erro: ${message}`),
    ...result.warnings.map(message => `Aviso: ${message}`),
  ];
  output.textContent = lines.join("\n");
  source.innerHTML = result.valid ? result.summary.cenarios.map(row => `<option value="${row.id}">${scenarioCompetence(row)} — ${escapeHtml(row.nome || "Competência")}</option>`).join("") : "";
  source.disabled = !result.valid;
  restore.disabled = !result.valid;
  if (result.valid) restore.dataset.backupLoaded = backup.integrity?.sha256 || "backup-validado";
}

function profileRowValue(row) {
  return {
    id: row.dataset.profile,
    nome: row.querySelector('[data-field="nome"]').value.trim(),
    email: row.querySelector('[data-field="email"]').value.trim().toLowerCase(),
    role: row.querySelector('[data-field="role"]').value,
    ativo: row.querySelector('[data-field="ativo"]').checked,
  };
}

function updateProfileDirtyState(row) {
  const original = state.data.perfis.find(profile => profile.id === row.dataset.profile);
  if (!original) return;
  const current = profileRowValue(row);
  const dirty = current.nome !== String(original.nome || "").trim()
    || current.email !== String(original.email || "").trim().toLowerCase()
    || current.role !== original.role
    || current.ativo !== Boolean(original.ativo);
  row.classList.toggle("profile-row-dirty", dirty);
  row.querySelector("[data-save-profile]").disabled = !dirty;
  row.querySelector(".profile-change-status").hidden = !dirty;
}

function renderOnlineUsers() {
  const profiles = new Map(state.data.perfis.map(profile => [profile.id, profile]));
  const online = state.onlineUsers.filter(entry => profiles.has(entry.userId));
  const status = $("#presence-status");
  status.classList.toggle("error", state.presenceStatus === "error");
  status.textContent = state.presenceStatus === "error"
    ? "Presença indisponível"
    : state.presenceStatus === "connecting" ? "Conectando…" : `${online.length} online`;
  const viewNames = { dashboard: "Painel Geral", gratificacoes: "Quadro de Gratificações", relatorios: "Relatórios", referencias: "Referências", auditoria: "Auditoria", administracao: "Administração" };
  const rows = online.map(entry => {
    const profile = profiles.get(entry.userId);
    return `<tr><td><span class="online-dot" aria-label="Online"></span>${escapeHtml(profile.nome || "—")}</td><td>${escapeHtml(profile.email)}</td><td>${escapeHtml(profile.role)}</td><td>${escapeHtml(viewNames[entry.currentView] || entry.currentView)}</td><td>${dateTime(entry.onlineAt)}</td><td class="number">${entry.connections}</td></tr>`;
  }).join("");
  $("#online-users-table").innerHTML = `<thead><tr><th>Usuário</th><th>E-mail</th><th>Perfil</th><th>Seção atual</th><th>Desde</th><th class="number">Conexões</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty-state">Nenhum usuário online detectado.</td></tr>'}</tbody>`;
}

function referenceRows(scenarioId) {
  const stored = state.data.referencias.filter(row => row.cenario_id === scenarioId);
  if (stored.length) return stored.sort((a, b) => a.codigo.localeCompare(b.codigo));
  return state.data.tipos.map(type => ({
    codigo: type.codigo,
    valor_integral: type.valor_integral,
    percentual_com_vinculo: type.percentual_com_vinculo ?? "0.6500",
    valor_com_vinculo: type.valor_com_vinculo_manual ?? type.valor_com_vinculo,
    valor_personalizado: Boolean(type.valor_com_vinculo_manual),
    ativo: type.ativo !== false,
  }));
}

function linkedReferenceValue(integral, percentageValue) {
  return fromDecimal4(linkedValueFromPercent(integral || 0, percentageValue || 0)).toFixed(2);
}

function percentageInput(value) { return (Number(value || 0) * 100).toFixed(2); }
function moneyInput(value) { return Number(value || 0).toFixed(2); }
function ratioInput(value) { return fromDecimal4(decimal4(value || 0) / 100n).toFixed(4); }

function renderReferenceTable(rows) {
  const body = rows.map(row => {
    const custom = Boolean(row.valor_personalizado);
    return `<tr data-reference-code="${row.codigo}" class="${custom ? "custom-reference-row" : ""}"><td><strong>${row.codigo}</strong></td><td><input data-reference-field="integral" type="number" min="0" step="0.01" value="${moneyInput(row.valor_integral)}" aria-label="Valor integral ${row.codigo}" required></td><td><input data-reference-field="percentage" type="number" min="0" max="100" step="0.01" value="${percentageInput(row.percentual_com_vinculo)}" aria-label="Percentual com vínculo ${row.codigo}" required></td><td><input data-reference-field="linked" type="number" min="0" step="0.01" value="${moneyInput(row.valor_com_vinculo)}" aria-label="Valor com vínculo ${row.codigo}" ${custom ? "" : "readonly"} required></td><td><label class="reference-custom"><input data-reference-field="custom" type="checkbox" ${custom ? "checked" : ""}> Valor personalizado</label></td><td>${row.ativo !== false ? "Ativo" : "Inativo"}</td></tr>`;
  }).join("");
  $("#references-table").innerHTML = `<thead><tr><th>Tipo</th><th class="number">Valor integral</th><th class="number">% com vínculo</th><th class="number">Valor com vínculo</th><th>Regra</th><th>Situação</th></tr></thead><tbody>${body}</tbody>`;
}

function renderReferenceDraft({ scenario = null, rows, competence = "", copy = false, sourceScenarioId = null }) {
  const form = $("#references-form");
  form.elements.cenario_id.value = scenario?.id ?? "";
  form.elements.source_cenario_id.value = sourceScenarioId ?? "";
  form.elements.orcamento_paradigma.value = moneyInput(scenario?.orcamento_paradigma ?? currentScenario()?.orcamento_paradigma ?? 0);
  form.elements.competencia.value = competence || String(scenario?.competencia ?? "").slice(0, 7);
  form.elements.activate.checked = scenario?.status === "VIGENTE";
  form.elements.complete_data.checked = scenario?.dados_individualizados_completos ?? (copy && Boolean(state.data.cenarios.find(row => row.id === sourceScenarioId)?.dados_individualizados_completos));
  const copyField = $("#copy-grants-field");
  copyField.hidden = !copy;
  form.elements.copy_grants.checked = copy;
  $("#reference-status").textContent = scenario ? `Situação: ${scenarioDisplayStatus(scenario)}` : (copy ? "Nova competência — referências copiadas" : "Nova competência — percentual padrão de 65,00%");
  $("#reference-validation").textContent = "";
  renderReferenceTable(rows);
  const editable = !scenario || canEditScenario(scenario);
  [...form.querySelectorAll('input:not([type="hidden"]),select')].forEach(field => { field.disabled = !editable; });
  $("#save-references").hidden = !editable;
  $("#close-competence").hidden = !scenario || !["RASCUNHO","VIGENTE"].includes(scenario.status);
  $("#archive-competence").hidden = !scenario || scenario.status !== "APROVADO";
  $("#reopen-competence").hidden = !scenario || !["APROVADO","ARQUIVADO"].includes(scenario.status) || state.identity.profile.role !== "admin";
}

function nextReferenceCompetence() {
  const latest = state.data.cenarios.map(row => String(row.competencia).slice(0, 7)).sort().at(-1) || scenarioCompetence();
  const [year, month] = latest.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function renderReferences() {
  if (!canWrite()) return;
  const select = $("#reference-scenario");
  const scenarios = [...state.data.cenarios].sort((a, b) => String(b.competencia).localeCompare(String(a.competencia)));
  select.innerHTML = scenarios.map(row => `<option value="${row.id}">${scenarioCompetence(row)}${row.status === "VIGENTE" ? " — vigente" : ""}</option>`).join("");
  const scenarioId = state.referenceScenarioId && scenarios.some(row => row.id === state.referenceScenarioId)
    ? state.referenceScenarioId : (currentScenario()?.id ?? scenarios[0]?.id);
  state.referenceScenarioId = scenarioId;
  select.value = scenarioId ?? "";
  const scenario = scenarios.find(row => row.id === scenarioId);
    renderReferenceDraft({ scenario, rows: referenceRows(scenarioId) });
}

function collectReferences() {
  return [...$("#references-table").querySelectorAll("tbody tr")].map(row => {
    const integral = row.querySelector('[data-reference-field="integral"]').value;
    const percentageValue = row.querySelector('[data-reference-field="percentage"]').value;
    const linked = row.querySelector('[data-reference-field="linked"]').value;
    const custom = row.querySelector('[data-reference-field="custom"]').checked;
    return {
      codigo: row.dataset.referenceCode,
      valor_integral: moneyInput(integral),
      percentual_com_vinculo: ratioInput(percentageValue),
      valor_com_vinculo: custom ? moneyInput(linked) : linkedReferenceValue(integral, percentageValue),
      valor_personalizado: custom,
      ativo: true,
    };
  });
}

function populateOptions() {
  const typeOptions = state.data.tipos.map(item => `<option value="${item.codigo}">${item.codigo}</option>`).join("");
  $("#filter-type").innerHTML = `<option value="">Todas as CJs</option>${typeOptions}`;
  $("#report-type").innerHTML = `<option value="">Todos</option>${typeOptions}`;
  const situationOptions = [...new Set(state.data.gratificacoesTodas.map(row => row.situacao))].sort().map(value => `<option>${escapeHtml(value)}</option>`).join("");
  $("#report-situation").innerHTML = `<option value="">Todas</option>${situationOptions}`;
  const unitOptions = [...new Map(state.data.gratificacoesTodas.map(row => [row.unidade_sigla, row.unidade_nome])).entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([sigla, nome]) => `<option value="${escapeHtml(sigla)}">${escapeHtml(sigla)} — ${escapeHtml(nome)}</option>`).join("");
  $("#report-unit").innerHTML = `<option value="">Todas</option>${unitOptions}`;
  $("#report-field-options").innerHTML = REPORT_FIELDS.map(field => `<label><input type="checkbox" value="${field.key}">${field.label}</label>`).join("");
  $("#report-group").innerHTML = `<option value="">Sem agrupamento</option>${REPORT_FIELDS.filter(field => field.groupable).map(field => `<option value="${field.key}">${field.label}</option>`).join("")}`;
  $("#report-order").innerHTML = REPORT_FIELDS.map(field => `<option value="${field.key}">${field.label}</option>`).join("");
  $("#grant-form [name=tipo_id]").innerHTML = state.data.tipos.map(item => `<option value="${item.id}">${item.codigo}</option>`).join("");
  const scenarioOptions = [...state.data.cenarios].sort((a,b) => String(b.competencia).localeCompare(String(a.competencia))).map(row => `<option value="${row.id}">${scenarioDisplayName(row)}</option>`).join("");
  $("#grant-scenario").innerHTML = scenarioOptions;
  $("#report-scenario").innerHTML = scenarioOptions;
  $("#report-compare-scenario").innerHTML = `<option value="">Sem comparação</option>${scenarioOptions}`;
  $("#csjt-reference").innerHTML = scenarioOptions;
  if (!state.data.cenarios.some(row => row.id === state.csjtScenarioId)) state.csjtScenarioId = currentScenario()?.id ?? "";
  if (!state.data.cenarios.some(row => row.id === reportConfig.scenario)) reportConfig.scenario = currentScenario()?.id ?? "";
  if (!state.data.cenarios.some(row => row.id === reportConfig.compareScenario)) reportConfig.compareScenario = "";
  applyReportConfig();
}

function renderScenarioControls() {
  const scenario = currentScenario();
  $("#grant-scenario").value = scenario?.id ?? "";
  $("#grant-scenario-status").textContent = `${SCENARIO_LABELS[scenario?.status] || scenario?.status || ""}${scenario?.dados_individualizados_completos === false ? " · dados incompletos" : ""}`;
}

function renderAll() { renderScenarioControls(); refreshSummary(); renderCards(); renderSummary(); renderGrants(); renderCsjt(); renderReport(); renderReferences(); renderAudit(); renderProfiles(); renderOnlineUsers(); renderBackupValidation(); }

function updateNewGrantVisibility(activeView) {
  $("#new-grant").hidden = !(canEditScenario() && activeView === "gratificacoes");
}

function openGrant(id = null) {
  if (!canEditScenario()) return toast("Esta competência está disponível somente para leitura.", true);
  const form = $("#grant-form"); form.reset(); form.elements.id.value = "";
  form.elements.lock_version.value = "0";
  form.dataset.scenarioId = currentScenario()?.id ?? "";
  $("#grant-dialog-competence").textContent = `Competência ${scenarioCompetence()} — ${SCENARIO_LABELS[currentScenario()?.status]}`;
  if (id) {
    const row = state.data.gratificacoesTodas.find(item => item.id === id);
    for (const name of ["id","lock_version","tipo_id","servidor_nome","unidade_sigla","unidade_nome","situacao","observacoes"]) if (form.elements[name]) form.elements[name].value = row[name] ?? "";
    form.elements.com_vinculo.value = String(row.com_vinculo);
  }
  $("#grant-dialog").showModal();
}

async function reload() { state.data = await loadApplicationData(state.identity.profile.role); if (!state.data.cenarios.some(row => row.id === state.scenarioId)) state.scenarioId = vigenteScenario()?.id; populateOptions(); renderAll(); }

function bindEvents() {
  $("#login-form").addEventListener("submit", async event => { event.preventDefault(); try { await signIn(event.target.email.value, event.target.password.value); await start(); } catch (error) { toast(error.message, true); } });
  $("#first-access").addEventListener("click", () => showRecoveryCode($("#email").value, "invite"));
  $("#reset-password").addEventListener("click", async event => { const email = $("#email").value; if (!email) return toast("Informe seu e-mail.", true); event.currentTarget.disabled = true; try { await requestPasswordReset(email); showRecoveryCode(email, "recovery"); toast("Código enviado. Consulte o e-mail mais recente."); } catch (error) { toast(error.message, true); } finally { event.currentTarget.disabled = false; } });
  $("#recovery-code-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      await verifyAccessCode(event.target.email.value, event.target.code.value, accessCodeType);
      clearAuthRedirect(true);
      showPasswordRecovery();
      toast(accessCodeType === "invite" ? "Convite confirmado. Defina sua primeira senha." : "Código confirmado. Defina sua nova senha.");
    } catch (error) {
      const expiredMessage = accessCodeType === "invite"
        ? "Código de convite inválido ou expirado. Solicite um novo convite ao administrador."
        : "Código inválido ou expirado. Solicite um novo código.";
      toast(error.code === "otp_expired" ? expiredMessage : error.message, true);
    } finally { button.disabled = false; }
  });
  $("#cancel-recovery").addEventListener("click", showLogin);
  $("#password-recovery-form").addEventListener("submit", async event => {
    event.preventDefault();
    const { password, confirmation } = event.target.elements;
    if (password.value !== confirmation.value) return toast("As senhas informadas não são iguais.", true);
    try {
      await updatePassword(password.value);
      passwordRecoveryPending = false;
      clearAuthRedirect(true);
      $("#password-recovery-view").hidden = true;
      toast("Senha atualizada com sucesso.");
      await start();
    } catch (error) { toast(error.message, true); }
  });
  $("#logout").addEventListener("click", async () => { await stopPresence(); await signOut(); location.reload(); });
  $$('nav button[data-view]').forEach(button => button.addEventListener("click", () => { $$('nav button').forEach(item => item.classList.remove("active")); button.classList.add("active"); $$(".view").forEach(view => view.classList.remove("active-view")); $(`#${button.dataset.view}`).classList.add("active-view"); $("#page-title").textContent = button.textContent; const directCsjt = button.dataset.reportView === "csjt"; $("#report-switcher").hidden = directCsjt; if (button.dataset.view === "relatorios") setReportView(directCsjt ? "csjt" : "custom"); updateNewGrantVisibility(button.dataset.view); void updatePresence(button.dataset.view); }));
  $("#reference-scenario").addEventListener("change", event => {
    state.referenceScenarioId = event.target.value;
    const scenario = state.data.cenarios.find(row => row.id === state.referenceScenarioId);
    renderReferenceDraft({ scenario, rows: referenceRows(state.referenceScenarioId) });
  });
  $("#new-reference").addEventListener("click", () => {
    const rows = state.data.tipos.map(type => ({
      codigo: type.codigo,
      valor_integral: type.valor_integral,
      percentual_com_vinculo: "0.6500",
      valor_com_vinculo: linkedReferenceValue(type.valor_integral, "65.00"),
      valor_personalizado: false,
      ativo: true,
    }));
    state.referenceScenarioId = null;
    renderReferenceDraft({ rows, competence: nextReferenceCompetence() });
  });
  $("#copy-reference").addEventListener("click", () => {
    const sourceId = $("#reference-scenario").value;
    const source = state.data.cenarios.find(row => row.id === sourceId);
    if (!source) return toast("Selecione uma competência para copiar.", true);
    state.referenceScenarioId = null;
    renderReferenceDraft({ rows: referenceRows(sourceId), competence: nextReferenceCompetence(), scenario: null, copy: true, sourceScenarioId: sourceId });
    $("#references-form").elements.orcamento_paradigma.value = moneyInput(source.orcamento_paradigma);
  });
  $("#references-table").addEventListener("input", event => {
    const row = event.target.closest("tr[data-reference-code]");
    if (!row) return;
    const custom = row.querySelector('[data-reference-field="custom"]');
    const linked = row.querySelector('[data-reference-field="linked"]');
    if (event.target === custom) {
      linked.readOnly = !custom.checked;
      row.classList.toggle("custom-reference-row", custom.checked);
    }
    if (!custom.checked) {
      const integral = row.querySelector('[data-reference-field="integral"]').value;
      const percentageValue = row.querySelector('[data-reference-field="percentage"]').value;
      linked.value = linkedReferenceValue(integral, percentageValue);
    }
  });
  $("#references-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const scenarioId = form.elements.cenario_id.value || null;
    if (scenarioId && !confirm("Salvar novos parâmetros para esta competência? Os valores anteriores permanecerão registrados na Auditoria.")) return;
    const references = collectReferences();
    const invalid = references.some(row => Number(row.valor_integral) < 0 || Number(row.valor_com_vinculo) < 0 || Number(row.percentual_com_vinculo) < 0 || Number(row.percentual_com_vinculo) > 1);
    if (invalid) return toast("Revise os valores monetários e percentuais informados.", true);
    const button = event.submitter;
    button.disabled = true;
    $("#reference-validation").textContent = "Salvando…";
    try {
      const savedId = await saveFinancialReferences({
        cenarioId: scenarioId,
        competencia: form.elements.competencia.value,
        orcamentoParadigma: moneyInput(form.elements.orcamento_paradigma.value),
        activate: form.elements.activate.checked,
        references,
        sourceScenarioId: form.elements.source_cenario_id.value || null,
        copyGrants: form.elements.copy_grants.checked,
        dataComplete: form.elements.complete_data.checked,
      });
      state.referenceScenarioId = savedId;
      state.scenarioId = savedId;
      await reload();
      toast("Referências financeiras salvas e cálculos atualizados.");
    } catch (error) {
      $("#reference-validation").textContent = "Não foi possível salvar.";
      toast(error.message, true);
    } finally { button.disabled = false; }
  });
  const changeStatus = async (status, message) => {
    const scenarioId = $("#references-form").elements.cenario_id.value;
    if (!scenarioId || !confirm(message)) return;
    try { await changeCompetenceStatus(scenarioId, status); await reload(); toast("Situação da competência atualizada."); }
    catch (error) { toast(error.message, true); }
  };
  $("#close-competence").addEventListener("click", () => changeStatus("APROVADO", "Encerrar esta competência e bloquear novas alterações?"));
  $("#archive-competence").addEventListener("click", () => changeStatus("ARQUIVADO", "Arquivar esta competência?"));
  $("#reopen-competence").addEventListener("click", () => changeStatus("RASCUNHO", "Reabrir esta competência para edição? A operação será auditada."));
  $("#grant-scenario").addEventListener("change", event => {
    state.scenarioId = event.target.value;
    renderAll();
    const activeView = $(".active-view")?.id;
    updateNewGrantVisibility(activeView);
  });
  $("#csjt-reference").addEventListener("change", event => { state.csjtScenarioId = event.target.value; renderCsjt(); });
  $("#new-grant").addEventListener("click", () => openGrant());
  ["#search","#filter-type","#filter-link"].forEach(selector => $(selector).addEventListener("input", renderGrants));
  ["#report-scenario","#report-compare-scenario","#report-type","#report-situation","#report-link","#report-active","#report-unit","#report-group","#report-order","#report-direction"].forEach(selector => $(selector).addEventListener("change", () => { readReportConfig(); renderReport(); }));
  ["#report-search","#report-title"].forEach(selector => $(selector).addEventListener("input", () => { readReportConfig(); renderReport(); }));
  $("#report-field-options").addEventListener("change", () => { readReportConfig(); renderReport(); });
  $("#reset-report").addEventListener("click", () => { reportConfig = { ...DEFAULT_REPORT_CONFIG, fields: [...DEFAULT_REPORT_CONFIG.fields] }; saveReportConfig(); applyReportConfig(); renderReport(); toast("Configuração do relatório restaurada."); });
  $("#show-custom-report").addEventListener("click", () => { $("#page-title").textContent = "Relatórios"; setReportView("custom"); });
  $("#show-csjt-report").addEventListener("click", () => { $("#page-title").textContent = "Relatórios"; setReportView("csjt"); });
  $("#clear-audit").addEventListener("click", async event => {
    const confirmation = prompt('Esta ação removerá permanentemente o histórico atual. Digite "LIMPAR AUDITORIA" para confirmar.');
    if (confirmation !== "LIMPAR AUDITORIA") {
      if (confirmation !== null) toast("Confirmação incorreta. Nenhum registro foi removido.", true);
      return;
    }
    event.currentTarget.disabled = true;
    try {
      const deleted = await clearAuditLogs();
      await reload();
      toast(`${deleted} registro${deleted === 1 ? " removido" : "s removidos"}. A limpeza foi registrada na auditoria.`);
    } catch (error) { toast(error.message, true); }
    finally { event.currentTarget.disabled = false; }
  });
  $("#export-backup").addEventListener("click", async event => {
    if (state.identity?.profile.role !== "admin") return toast("Somente administradores podem exportar backups.", true);
    event.currentTarget.disabled = true;
    try {
      const backup = await exportOperationalBackup($("#backup-include-audit").checked);
      const result = validateBackup(backup);
      if (!result.valid) throw new Error(`O backup gerado não passou na validação: ${result.errors.join(" ")}`);
      downloadBackup(backup);
      toast("Backup exportado e validado.");
    } catch (error) { toast(error.message, true); }
    finally { event.currentTarget.disabled = false; }
  });
  $("#backup-file").addEventListener("change", async event => {
    const file = event.currentTarget.files?.[0];
    validatedBackup = null;
    if (!file) return renderBackupValidation();
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("O arquivo excede o limite de 10 MB.");
      const backup = JSON.parse(await file.text());
      validatedBackup = { backup, result: validateBackup(backup) };
    } catch (error) { validatedBackup = { backup: {}, result: { valid: false, errors: [`Não foi possível ler o backup: ${error.message}`], warnings: [], summary: null } }; }
    if (validatedBackup?.result.valid && !$("#backup-target-competence").value) $("#backup-target-competence").value = nextReferenceCompetence();
    renderBackupValidation();
  });
  $("#restore-backup").addEventListener("click", async event => {
    if (state.identity?.profile.role !== "admin" || !validatedBackup?.result.valid) return;
    const target = $("#backup-target-competence").value;
    const source = $("#backup-source-scenario").value;
    if (!/^\d{4}-\d{2}$/.test(target) || !source) return toast("Informe a competência de destino e a origem do backup.", true);
    const sourceScenario = validatedBackup.result.summary.cenarios.find(row => row.id === source);
    if (!confirm(`Restaurar ${scenarioCompetence(sourceScenario)} como nova competência ${target.slice(5, 7)}/${target.slice(0, 4)}? A competência será criada em rascunho e nenhum dado existente será substituído.`)) return;
    event.currentTarget.disabled = true;
    try {
      const id = await restoreBackupAsNewCompetence(validatedBackup.backup, target, source);
      state.scenarioId = id;
      validatedBackup = null;
      await reload();
      toast("Backup restaurado como nova competência em rascunho.");
    } catch (error) { toast(error.message, true); }
    finally { event.currentTarget.disabled = false; }
  });
  $("#grants-table").addEventListener("click", async event => {
    const sort = event.target.closest("[data-sort-grants]")?.dataset.sortGrants;
    if (sort) {
      grantSort = { key: sort, direction: grantSort.key === sort && grantSort.direction === "asc" ? "desc" : "asc" };
      renderGrants();
      return;
    }
    const edit = event.target.dataset.edit;
    const inactivate = event.target.dataset.delete;
    const remove = event.target.dataset.removeGrant;
    if (edit) return openGrant(edit);
    if (inactivate && confirm("Inativar esta gratificação somente nesta competência?")) {
      try { await inactivateGrant(inactivate, event.target.dataset.version); await reload(); toast("Gratificação inativada nesta competência."); }
      catch (error) { toast(error.message, true); }
      return;
    }
    if (remove && confirm("Excluir definitivamente esta gratificação desta competência? Esta ação não pode ser desfeita.")) {
      event.target.disabled = true;
      try { await deleteGrant(remove, event.target.dataset.version); await reload(); toast("Gratificação excluída definitivamente."); }
      catch (error) { toast(error.message, true); }
      finally { if (event.target.isConnected) event.target.disabled = false; }
    }
  });
  $("#grant-form").addEventListener("submit", async event => { event.preventDefault(); const form = new FormData(event.target); const record = Object.fromEntries(form); record.com_vinculo = record.com_vinculo === "true"; record.cenario_id = event.target.dataset.scenarioId; try { await saveGrant(record); $("#grant-dialog").close(); await reload(); toast("Gratificação salva."); } catch (error) { toast(error.message, true); } });
  $("#profiles-table").addEventListener("click", async event => {
    const saveId = event.target.dataset.saveProfile;
    const deleteId = event.target.dataset.deleteProfile;
    if (saveId) {
      const row = event.target.closest("tr");
      const user = profileRowValue(row);
      const profile = state.data.perfis.find(item => item.id === saveId);
      const nameInput = row.querySelector('[data-field="nome"]');
      const emailInput = row.querySelector('[data-field="email"]');
      if (!nameInput.reportValidity() || !emailInput.reportValidity()) return;
      const ownAccount = saveId === state.identity.profile.id;
      if (ownAccount && user.email !== String(profile.email).toLowerCase()
        && !confirm(`Você está alterando o e-mail da própria conta para ${user.email}. Após salvar, use o novo e-mail nos próximos acessos. Deseja continuar?`)) return;
      if (profile.role === "admin" && profile.ativo && (user.role !== "admin" || !user.ativo)
        && !confirm("Esta alteração removerá um administrador ativo. O sistema impedirá a remoção do último administrador. Deseja continuar?")) return;
      event.target.disabled = true;
      try {
        const result = await updateUser(user);
        if (ownAccount && !user.ativo) {
          await signOut();
          location.reload();
          return;
        }
        if (ownAccount) {
          toast(result.warning || "Usuário atualizado. A sessão será recarregada.", Boolean(result.warning));
          setTimeout(() => location.reload(), 700);
          return;
        }
        await reload();
        toast(result.warning || "Usuário atualizado.", Boolean(result.warning));
      }
      catch (error) { toast(error.message, true); }
      finally { if (event.target.isConnected) event.target.disabled = false; }
      return;
    }
    if (!deleteId) return;
    const profile = state.data.perfis.find(item => item.id === deleteId);
    if (!profile) return toast("Usuário não encontrado.", true);
    const dirtyWarning = event.target.closest("tr")?.classList.contains("profile-row-dirty") ? " Alterações ainda não salvas serão ignoradas." : "";
    const confirmation = prompt(`Esta exclusão é permanente.${dirtyWarning} Para confirmar, digite o e-mail cadastrado ${profile.email}`);
    if (confirmation === null) return;
    if (confirmation.trim().toLowerCase() !== profile.email.toLowerCase()) return toast("O e-mail de confirmação não confere.", true);
    event.target.disabled = true;
    try {
      const result = await deleteUser(deleteId);
      await reload();
      toast(result.warning || "Usuário excluído permanentemente.", Boolean(result.warning));
    } catch (error) { toast(error.message, true); }
    finally { event.target.disabled = false; }
  });
  for (const eventName of ["input", "change"]) {
    $("#profiles-table").addEventListener(eventName, event => {
      if (!event.target.matches("[data-field]")) return;
      updateProfileDirtyState(event.target.closest("tr"));
    });
  }
  $("#user-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.target);
    const button = event.submitter;
    button.disabled = true;
    try {
      await inviteUser(form.get("nome"), form.get("email"), form.get("role"));
      event.target.reset();
      await reload();
      toast("Usuário cadastrado. Código de primeiro acesso enviado por e-mail.");
    } catch (error) { toast(error.message, true); }
    finally { button.disabled = false; }
  });
  $("#export-csv").addEventListener("click", () => { readReportConfig(); const fields = selectedReportFields(); if (!fields.length) return toast("Selecione ao menos um campo.", true); const csv = [fields.map(field => field.label).join(";"), ...reportRows().map(row => fields.map(field => `"${String(reportValue(field, row) ?? "").replaceAll('"','""')}"`).join(";"))].join("\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" })); const scenario = state.data.cenarios.find(row => row.id === reportConfig.scenario) ?? currentScenario(); link.download = `relatorio-gratificacoes-${scenarioCompetence(scenario)}.csv`; link.click(); URL.revokeObjectURL(link.href); });
  $("#print-report").addEventListener("click", () => { document.body.classList.add("printing-report"); window.print(); setTimeout(() => document.body.classList.remove("printing-report"), 300); });
  $("#print-csjt").addEventListener("click", () => { document.body.classList.add("printing-csjt"); window.print(); setTimeout(() => document.body.classList.remove("printing-csjt"), 300); });
}

async function start() {
  if (passwordRecoveryPending) return;
  state.identity = await currentIdentity();
  if (!state.identity) return;
  state.data = await loadApplicationData(state.identity.profile.role);
  state.scenarioId = vigenteScenario()?.id;
  $("#login-view").hidden = true; $("#app-view").hidden = false;
  $("#profile-name").textContent = state.identity.profile.nome || state.identity.profile.email;
  $("#profile-role").textContent = state.identity.profile.role;
  $$('[data-role]').forEach(element => element.hidden = !element.dataset.role.split(",").includes(state.identity.profile.role));
  updateNewGrantVisibility("dashboard");
  populateOptions(); renderAll();
  startPresence(state.identity, onlineUsers => {
    state.onlineUsers = onlineUsers;
    state.presenceStatus = "connected";
    renderOnlineUsers();
  }, status => {
    state.presenceStatus = status;
    renderOnlineUsers();
  });
}

bindEvents();
if (!isConfigured()) $("#setup-warning").hidden = false;
else {
  handleAuthRedirectError();
  onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" || (passwordRecoveryPending && session)) showPasswordRecovery();
  });
  if (recoveryCodePending) showRecoveryCode("", accessCodeType);
  if (!passwordRecoveryPending && !recoveryCodePending) start().catch(error => toast(error.message, true));
}
