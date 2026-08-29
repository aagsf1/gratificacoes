import { isConfigured } from "./app-config.js?v=20260829-admin";
import { currentIdentity, onAuthStateChange, requestPasswordReset, signIn, signOut, updatePassword, verifyAccessCode } from "./auth.js?v=20260829-admin";
import { deleteUser, inactivateGrant, inviteUser, loadApplicationData, saveGrant, updateProfile } from "./data-service.js?v=20260829-admin";
import { decimal4, fromDecimal4, summarize, summarizeCsjt } from "./calc.js?v=20260829-admin";
import { startPresence, stopPresence, updatePresence } from "./presence.js?v=20260829-presence-v3";

const state = { identity: null, data: null, summary: null, onlineUsers: [], presenceStatus: "connecting" };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const money = (value, digits = 2) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const dateTime = value => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "—";
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const canWrite = () => ["admin", "gestor"].includes(state.identity?.profile.role);
const REPORT_FIELDS = [
  { key: "id", label: "ID" },
  { key: "tipo_codigo", label: "Gratificação", groupable: true },
  { key: "unidade_nome", label: "Unidade", groupable: true },
  { key: "servidor_nome", label: "Servidor" },
  { key: "com_vinculo", label: "Vínculo", groupable: true, format: row => row.com_vinculo ? "Com vínculo" : "Sem vínculo" },
  { key: "situacao", label: "Situação", groupable: true },
  { key: "unidade_sigla", label: "Sigla", groupable: true },
  { key: "valor_integral", label: "Valor integral", numeric: true, format: row => money(Number(row.valor_integral), 2) },
  { key: "percentual_aplicado", label: "% aplicado", numeric: true, format: row => `${(row.com_vinculo ? Number(row.percentual_com_vinculo) * 100 : 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%` },
  { key: "valor_pago", label: "Valor pago", numeric: true, format: row => money(Number(row.valor_pago), 4) },
  { key: "observacoes", label: "Observações" },
  { key: "ativo", label: "Status", groupable: true, format: row => row.ativo ? "Ativa" : "Inativa" },
];
const REPORT_STORAGE = "gratificacoes_report_config_v2";
const DEFAULT_REPORT_CONFIG = Object.freeze({
  title: "Relatório customizado de gratificações",
  fields: ["tipo_codigo", "unidade_sigla", "unidade_nome", "servidor_nome", "com_vinculo", "situacao", "valor_integral", "valor_pago"],
  search: "", type: "", link: "", situation: "", unit: "", active: "", group: "", order: "unidade_sigla", direction: "asc",
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
  element.style.background = error ? "#9f2d2d" : "#152542";
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

function currentScenario() {
  return state.data.cenarios.find(item => item.status === "VIGENTE") ?? state.data.cenarios[0];
}

function refreshSummary() {
  const scenario = currentScenario();
  state.summary = summarize(state.data.gratificacoes, state.data.tipos, scenario?.orcamento_paradigma ?? 0);
}

function renderCards() {
  const t = state.summary.totals;
  const cards = [
    ["Orçamento paradigma", money(fromDecimal4(t.budget4), 2)],
    ["Total pago", money(fromDecimal4(t.paid4), 4)],
    ["Saldo", money(fromDecimal4(t.balance4), 4), t.balance4 >= 0n ? "good" : "warn"],
    ["Execução", `${(t.execution * 100).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`, t.execution > 1 ? "warn" : ""],
    ["Gratificações", t.count], ["Com vínculo", t.linked], ["Sem vínculo", t.unlinked],
    ["Proporção com vínculo", `${(t.count ? t.linked / t.count * 100 : 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`],
  ];
  $("#cards").innerHTML = cards.map(([label, value, className = ""]) => `<article class="card ${className}"><small>${label}</small><strong>${value}</strong></article>`).join("");
}

function renderSummary() {
  const max = Math.max(...state.summary.rows.map(row => row.count), 1);
  $("#type-bars").innerHTML = state.summary.rows.map(row => `<div class="bar-row"><strong>${row.codigo}</strong><div class="bar"><span style="width:${row.count / max * 100}%"></span></div><span>${row.count}</span></div>`).join("");
  $("#summary-table").innerHTML = `<thead><tr><th>Tipo</th><th class="number">Com vínculo</th><th class="number">Sem vínculo</th><th class="number">Total</th><th class="number">Valor pago</th></tr></thead><tbody>${state.summary.rows.map(row => `<tr><td>${row.codigo}</td><td class="number">${row.linked}</td><td class="number">${row.unlinked}</td><td class="number">${row.count}</td><td class="number">${money(fromDecimal4(row.paid4), 4)}</td></tr>`).join("")}</tbody>`;
}

function filteredGrants() {
  const query = $("#search").value.trim().toLocaleLowerCase("pt-BR");
  const type = $("#filter-type").value;
  const link = $("#filter-link").value;
  return state.data.gratificacoes.filter(row => {
    const haystack = `${row.servidor_nome} ${row.unidade_nome} ${row.unidade_sigla}`.toLocaleLowerCase("pt-BR");
    return (!query || haystack.includes(query)) && (!type || row.tipo_codigo === type) && (!link || String(row.com_vinculo) === link);
  });
}

function renderGrants() {
  const rows = filteredGrants();
  $("#grants-table").innerHTML = `<thead><tr><th>Tipo</th><th>Servidor</th><th>Unidade</th><th>Sigla</th><th>Vínculo</th><th>Situação</th><th class="number">Valor pago</th>${canWrite() ? "<th>Ações</th>" : ""}</tr></thead><tbody>${rows.map(row => `<tr><td>${row.tipo_codigo}</td><td>${escapeHtml(row.servidor_nome || "—")}</td><td>${escapeHtml(row.unidade_nome)}</td><td>${escapeHtml(row.unidade_sigla)}</td><td>${row.com_vinculo ? "Sim" : "Não"}</td><td>${escapeHtml(row.situacao)}</td><td class="number">${money(Number(row.valor_pago), 4)}</td>${canWrite() ? `<td class="row-actions"><button data-edit="${row.id}">Editar</button><button class="secondary" data-delete="${row.id}">Inativar</button></td>` : ""}</tr>`).join("")}</tbody>`;
}

function csjtValues(summary) {
  return summary.rows.map(row => {
    const type = state.data.tipos.find(item => item.codigo === row.codigo);
    const unlinkedPaid4 = decimal4(type.valor_integral) * BigInt(row.unlinked);
    return { row, linkedPaid4: row.paid4 - unlinkedPaid4, unlinkedPaid4 };
  });
}

function csjtLine({ row, linkedPaid4, unlinkedPaid4 }) {
  return `<div class="csjt-row"><div class="csjt-cell green cargo">${row.codigo.replace("CJ-0", "CJ-")}</div><div class="csjt-cell blue">${row.linked}</div><div class="csjt-cell blue money">${money(fromDecimal4(linkedPaid4), 2)}</div><div class="csjt-cell yellow">${row.unlinked}</div><div class="csjt-cell yellow money">${money(fromDecimal4(unlinkedPaid4), 2)}</div><div class="csjt-cell green">${row.count}</div><div class="csjt-cell green money">${money(fromDecimal4(row.paid4), 2)}</div></div>`;
}

function csjtSection(title, summary, current = false) {
  const values = csjtValues(summary);
  const linkedPaid4 = values.reduce((sum, item) => sum + item.linkedPaid4, 0n);
  const unlinkedPaid4 = values.reduce((sum, item) => sum + item.unlinkedPaid4, 0n);
  const t = summary.totals;
  const ratio = value => `${(t.count ? value / t.count * 100 : 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
  const total = `<div class="csjt-row csjt-total"><div class="csjt-cell green cargo">Total</div><div class="csjt-cell blue">${t.linked}</div><div class="csjt-cell blue money">${money(fromDecimal4(linkedPaid4), 2)}</div><div class="csjt-cell yellow">${t.unlinked}</div><div class="csjt-cell yellow money">${money(fromDecimal4(unlinkedPaid4), 2)}</div><div class="csjt-cell green">${t.count}</div><div class="csjt-cell green money">${money(fromDecimal4(t.paid4), 2)}</div></div>`;
  return `<section class="csjt-section ${current ? "proposed" : ""}"><div class="csjt-big-title">${title}</div><div class="csjt-head"><div>Cargo</div><div>Qtd. efetivos</div><div>Valor efetivos</div><div>Qtd. sem vínculo</div><div>Valor sem Vínculo</div><div>Qtd. Total</div><div>Valor Total</div></div><div class="csjt-lines">${values.map(csjtLine).join("")}${total}</div><div class="csjt-bottom"><div class="csjt-info"><div class="info-title">${current ? "Orçamento paradigma (100%) - Situação Anterior" : "Orçamento paradigma (100%)"}</div><div class="info-note">Todas as CJs são calculadas como 100%</div><div class="info-value">${money(fromDecimal4(t.budget4), 2)}</div></div><div class="csjt-info"><div class="info-title proportion-title">${current ? "Proporção de distribuição entre<br>efetivos X sem vínculo" : "Proporção de distribuição efetivo X sem vínculo"}</div><div class="info-note blank">&nbsp;</div><div class="info-value proportion"><span>${ratio(t.linked)}</span><b>X</b><span>${ratio(t.unlinked)}</span></div></div><div class="csjt-info"><div class="info-title">${current ? "Sobra orçamentária atual" : "Valor Residual Limite"}</div><div class="info-note">${current ? "Diferença entre o orçamento paradigma e o valor total pago" : "Diferença entre o orçamento paradigma e as CJs 65%"}</div><div class="info-value ${t.balance4 < 0n ? "negative" : ""}">${money(fromDecimal4(t.balance4), 2)}</div></div></div></section>`;
}

function scenarioCompetence() {
  const value = currentScenario()?.competencia;
  return value ? String(value).slice(0, 7) : "não informada";
}

function renderCsjt() {
  const scenario = currentScenario();
  const summaries = summarizeCsjt(state.data.gratificacoesTodas, state.data.tipos, scenario?.orcamento_paradigma ?? 0);
  $("#csjt-competence").textContent = `Competência ${scenarioCompetence()} · valores recalculados a partir dos registros ativos`;
  $("#csjt-sheet").innerHTML = `${csjtSection("Situação Anterior", summaries.previous)}${csjtSection("Situação Atual", summaries.current, true)}`;
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
  const rows = state.data.gratificacoesTodas.filter(row => {
    const haystack = `${row.id} ${row.servidor_nome ?? ""} ${row.unidade_nome ?? ""} ${row.unidade_sigla ?? ""} ${row.tipo_codigo} ${row.situacao} ${row.observacoes ?? ""}`.toLocaleLowerCase("pt-BR");
    return (!reportConfig.type || row.tipo_codigo === reportConfig.type)
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
    return `<section class="report-group"><div class="report-group-head"><div><strong>${groupField.label}: ${escapeHtml(group)}</strong><span>${records.length} registro(s)</span></div><b>${money(paid, 4)}</b></div>${reportTable(records, fields)}</section>`;
  }).join("") || reportTable([], fields);
}

function renderReport() {
  const fields = selectedReportFields();
  const rows = reportRows();
  const totalPaid = rows.reduce((sum, row) => sum + Number(row.valor_pago || 0), 0);
  const totalIntegral = rows.reduce((sum, row) => sum + Number(row.valor_integral || 0), 0);
  const linked = rows.filter(row => row.com_vinculo).length;
  const unlinked = rows.length - linked;
  const budget = Number(currentScenario()?.orcamento_paradigma || 0);
  const balance = budget - totalPaid;
  $("#report-status").textContent = `${rows.length} registro${rows.length === 1 ? "" : "s"} selecionado${rows.length === 1 ? "" : "s"}`;
  $("#report-output-title").textContent = reportConfig.title;
  $("#report-generated").textContent = `Competência ${scenarioCompetence()} · Gerado em ${new Date().toLocaleString("pt-BR")}`;
  $("#report-metrics").innerHTML = `<article class="card"><small>Registros</small><strong>${rows.length}</strong><span>${linked} com vínculo · ${unlinked} sem vínculo</span></article><article class="card"><small>Valor pago selecionado</small><strong>${money(totalPaid, 4)}</strong></article><article class="card"><small>Valor integral selecionado</small><strong>${money(totalIntegral, 2)}</strong></article><article class="card"><small>Saldo vs. paradigma</small><strong class="${balance >= 0 ? "report-good" : "report-danger"}">${money(balance, 4)}</strong><span>Paradigma menos itens selecionados</span></article>`;
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
  $("#audit-table").innerHTML = `<thead><tr><th>Data</th><th>Usuário</th><th>Operação</th><th>Entidade</th><th>Registro</th><th>Antes</th><th>Depois</th></tr></thead><tbody>${state.data.auditoria.map(row => `<tr><td>${dateTime(row.created_at)}</td><td>${escapeHtml(row.actor_email || "—")}</td><td>${row.operation}</td><td>${row.entity}</td><td>${row.record_id || "—"}</td><td>${escapeHtml(JSON.stringify(row.old_data) || "—")}</td><td>${escapeHtml(JSON.stringify(row.new_data) || "—")}</td></tr>`).join("")}</tbody>`;
}

function renderProfiles() {
  $("#profiles-table").innerHTML = `<thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Ativo</th><th>Ações</th></tr></thead><tbody>${state.data.perfis.map(row => {
    const ownAccount = row.id === state.identity.profile.id;
    return `<tr data-profile="${row.id}"><td>${escapeHtml(row.nome || "—")}</td><td>${escapeHtml(row.email)}</td><td><select data-field="role">${["admin","gestor","consulta","auditor"].map(role => `<option ${row.role === role ? "selected" : ""}>${role}</option>`).join("")}</select></td><td><input data-field="ativo" type="checkbox" ${row.ativo ? "checked" : ""}></td><td><div class="row-actions"><button data-save-profile="${row.id}">Salvar</button><button class="danger" data-delete-profile="${row.id}" ${ownAccount ? 'disabled title="Sua própria conta não pode ser excluída"' : ""}>Excluir</button></div></td></tr>`;
  }).join("")}</tbody>`;
}

function renderOnlineUsers() {
  const profiles = new Map(state.data.perfis.map(profile => [profile.id, profile]));
  const online = state.onlineUsers.filter(entry => profiles.has(entry.userId));
  const status = $("#presence-status");
  status.classList.toggle("error", state.presenceStatus === "error");
  status.textContent = state.presenceStatus === "error"
    ? "Presença indisponível"
    : state.presenceStatus === "connecting" ? "Conectando…" : `${online.length} online`;
  const viewNames = { dashboard: "Dashboard", gratificacoes: "Gratificações", relatorios: "Relatórios", auditoria: "Auditoria", administracao: "Administração" };
  const rows = online.map(entry => {
    const profile = profiles.get(entry.userId);
    return `<tr><td><span class="online-dot" aria-label="Online"></span>${escapeHtml(profile.nome || "—")}</td><td>${escapeHtml(profile.email)}</td><td>${escapeHtml(profile.role)}</td><td>${escapeHtml(viewNames[entry.currentView] || entry.currentView)}</td><td>${dateTime(entry.onlineAt)}</td><td class="number">${entry.connections}</td></tr>`;
  }).join("");
  $("#online-users-table").innerHTML = `<thead><tr><th>Usuário</th><th>E-mail</th><th>Perfil</th><th>Seção atual</th><th>Desde</th><th class="number">Conexões</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty-state">Nenhum usuário online detectado.</td></tr>'}</tbody>`;
}

function populateOptions() {
  const typeOptions = state.data.tipos.map(item => `<option value="${item.codigo}">${item.codigo}</option>`).join("");
  $("#filter-type").insertAdjacentHTML("beforeend", typeOptions);
  $("#report-type").insertAdjacentHTML("beforeend", typeOptions);
  const situationOptions = [...new Set(state.data.gratificacoesTodas.map(row => row.situacao))].sort().map(value => `<option>${escapeHtml(value)}</option>`).join("");
  $("#report-situation").insertAdjacentHTML("beforeend", situationOptions);
  const unitOptions = [...new Map(state.data.gratificacoesTodas.map(row => [row.unidade_sigla, row.unidade_nome])).entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([sigla, nome]) => `<option value="${escapeHtml(sigla)}">${escapeHtml(sigla)} — ${escapeHtml(nome)}</option>`).join("");
  $("#report-unit").insertAdjacentHTML("beforeend", unitOptions);
  $("#report-field-options").innerHTML = REPORT_FIELDS.map(field => `<label><input type="checkbox" value="${field.key}">${field.label}</label>`).join("");
  $("#report-group").insertAdjacentHTML("beforeend", REPORT_FIELDS.filter(field => field.groupable).map(field => `<option value="${field.key}">${field.label}</option>`).join(""));
  $("#report-order").innerHTML = REPORT_FIELDS.map(field => `<option value="${field.key}">${field.label}</option>`).join("");
  applyReportConfig();
  $("#grant-form [name=tipo_id]").innerHTML = state.data.tipos.map(item => `<option value="${item.id}">${item.codigo}</option>`).join("");
}

function renderAll() { refreshSummary(); renderCards(); renderSummary(); renderGrants(); renderCsjt(); renderReport(); renderAudit(); renderProfiles(); renderOnlineUsers(); }

function updateNewGrantVisibility(activeView) {
  $("#new-grant").hidden = !(canWrite() && activeView === "gratificacoes");
}

function openGrant(id = null) {
  const form = $("#grant-form"); form.reset(); form.elements.id.value = "";
  form.dataset.scenarioId = currentScenario()?.id ?? "";
  if (id) {
    const row = state.data.gratificacoes.find(item => item.id === id);
    for (const name of ["id","tipo_id","servidor_nome","unidade_sigla","unidade_nome","situacao","observacoes"]) if (form.elements[name]) form.elements[name].value = row[name] ?? "";
    form.elements.com_vinculo.value = String(row.com_vinculo);
  }
  $("#grant-dialog").showModal();
}

async function reload() { state.data = await loadApplicationData(); renderAll(); }

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
  $$('nav button[data-view]').forEach(button => button.addEventListener("click", () => { $$('nav button').forEach(item => item.classList.remove("active")); button.classList.add("active"); $$(".view").forEach(view => view.classList.remove("active-view")); $(`#${button.dataset.view}`).classList.add("active-view"); $("#page-title").textContent = button.textContent; if (button.dataset.view === "relatorios") setReportView(button.dataset.reportView || "custom"); updateNewGrantVisibility(button.dataset.view); void updatePresence(button.dataset.view); }));
  $("#new-grant").addEventListener("click", () => openGrant());
  ["#search","#filter-type","#filter-link"].forEach(selector => $(selector).addEventListener("input", renderGrants));
  ["#report-type","#report-situation","#report-link","#report-active","#report-unit","#report-group","#report-order","#report-direction"].forEach(selector => $(selector).addEventListener("change", () => { readReportConfig(); renderReport(); }));
  ["#report-search","#report-title"].forEach(selector => $(selector).addEventListener("input", () => { readReportConfig(); renderReport(); }));
  $("#report-field-options").addEventListener("change", () => { readReportConfig(); renderReport(); });
  $("#reset-report").addEventListener("click", () => { reportConfig = { ...DEFAULT_REPORT_CONFIG, fields: [...DEFAULT_REPORT_CONFIG.fields] }; saveReportConfig(); applyReportConfig(); renderReport(); toast("Configuração do relatório restaurada."); });
  $("#show-custom-report").addEventListener("click", () => { $("#page-title").textContent = "Relatórios"; setReportView("custom"); });
  $("#show-csjt-report").addEventListener("click", () => { $("#page-title").textContent = "Relatórios"; setReportView("csjt"); });
  $("#grants-table").addEventListener("click", async event => { const edit = event.target.dataset.edit; const remove = event.target.dataset.delete; if (edit) openGrant(edit); if (remove && confirm("Inativar esta gratificação?")) { try { await inactivateGrant(remove); await reload(); toast("Gratificação inativada."); } catch (error) { toast(error.message, true); } } });
  $("#grant-form").addEventListener("submit", async event => { event.preventDefault(); const form = new FormData(event.target); const record = Object.fromEntries(form); record.com_vinculo = record.com_vinculo === "true"; record.cenario_id = event.target.dataset.scenarioId; try { await saveGrant(record); $("#grant-dialog").close(); await reload(); toast("Gratificação salva."); } catch (error) { toast(error.message, true); } });
  $("#profiles-table").addEventListener("click", async event => {
    const saveId = event.target.dataset.saveProfile;
    const deleteId = event.target.dataset.deleteProfile;
    if (saveId) {
      const row = event.target.closest("tr");
      try { await updateProfile(saveId, row.querySelector('[data-field=role]').value, row.querySelector('[data-field=ativo]').checked); await reload(); toast("Perfil atualizado."); }
      catch (error) { toast(error.message, true); }
      return;
    }
    if (!deleteId) return;
    const profile = state.data.perfis.find(item => item.id === deleteId);
    if (!profile) return toast("Usuário não encontrado.", true);
    const confirmation = prompt(`Esta exclusão é permanente. Para confirmar, digite o e-mail ${profile.email}`);
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
  $("#export-csv").addEventListener("click", () => { readReportConfig(); const fields = selectedReportFields(); if (!fields.length) return toast("Selecione ao menos um campo.", true); const csv = [fields.map(field => field.label).join(";"), ...reportRows().map(row => fields.map(field => `"${String(reportValue(field, row) ?? "").replaceAll('"','""')}"`).join(";"))].join("\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" })); link.download = `relatorio-gratificacoes-${scenarioCompetence()}.csv`; link.click(); URL.revokeObjectURL(link.href); });
  $("#print-report").addEventListener("click", () => { document.body.classList.add("printing-report"); window.print(); setTimeout(() => document.body.classList.remove("printing-report"), 300); });
  $("#print-csjt").addEventListener("click", () => { document.body.classList.add("printing-csjt"); window.print(); setTimeout(() => document.body.classList.remove("printing-csjt"), 300); });
}

async function start() {
  if (passwordRecoveryPending) return;
  state.identity = await currentIdentity();
  if (!state.identity) return;
  state.data = await loadApplicationData();
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
