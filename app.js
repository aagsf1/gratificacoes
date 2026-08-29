import { isConfigured } from "./app-config.js";
import { currentIdentity, onAuthStateChange, requestPasswordReset, signIn, signOut, updatePassword, verifyRecoveryCode } from "./auth.js";
import { inactivateGrant, inviteUser, loadApplicationData, saveGrant, updateProfile } from "./data-service.js";
import { decimal4, fromDecimal4, summarize, summarizeCsjt } from "./calc.js";

const state = { identity: null, data: null, summary: null };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const money = (value, digits = 2) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const dateTime = value => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "—";
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const canWrite = () => ["admin", "gestor"].includes(state.identity?.profile.role);
const REPORT_FIELDS = [
  { key: "tipo_codigo", label: "Tipo" },
  { key: "servidor_nome", label: "Servidor" },
  { key: "unidade_nome", label: "Unidade" },
  { key: "unidade_sigla", label: "Sigla" },
  { key: "com_vinculo", label: "Vínculo", format: row => row.com_vinculo ? "Com vínculo" : "Sem vínculo" },
  { key: "situacao", label: "Situação" },
  { key: "valor_pago", label: "Valor pago", numeric: true, format: row => money(Number(row.valor_pago), 4) },
  { key: "observacoes", label: "Observações" },
  { key: "ativo", label: "Status", format: row => row.ativo ? "Ativa" : "Inativa" },
];
const authRedirect = new URLSearchParams(window.location.hash.slice(1));
const authQuery = new URLSearchParams(window.location.search);
let passwordRecoveryPending = ["recovery", "invite"].includes(authRedirect.get("type"));
let recoveryCodePending = authQuery.get("recovery") === "1";

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
    ? "Este link de recuperação expirou ou já foi utilizado. Solicite um novo link e abra somente o e-mail mais recente."
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

function showRecoveryCode(email = "") {
  recoveryCodePending = true;
  $("#login-view").hidden = true;
  $("#password-recovery-view").hidden = true;
  $("#app-view").hidden = true;
  $("#recovery-code-view").hidden = false;
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

function csjtTable(summary, showRatios = false) {
  const values = summary.rows.map(row => {
    const type = state.data.tipos.find(item => item.codigo === row.codigo);
    const unlinkedPaid4 = decimal4(type.valor_integral) * BigInt(row.unlinked);
    return { row, linkedPaid4: row.paid4 - unlinkedPaid4, unlinkedPaid4 };
  });
  const body = values.map(({ row, linkedPaid4, unlinkedPaid4 }) => `<tr><th scope="row" class="cargo">${row.codigo}</th><td class="effective">${row.linked}</td><td class="effective">${money(fromDecimal4(linkedPaid4), 4)}</td><td class="unlinked">${row.unlinked}</td><td class="unlinked">${money(fromDecimal4(unlinkedPaid4), 4)}</td><td class="total">${row.count}</td><td class="total">${money(fromDecimal4(row.paid4), 4)}</td></tr>`).join("");
  const linkedPaid4 = values.reduce((sum, item) => sum + item.linkedPaid4, 0n);
  const unlinkedPaid4 = values.reduce((sum, item) => sum + item.unlinkedPaid4, 0n);
  const t = summary.totals;
  const percentage = value => `${(t.count ? value / t.count * 100 : 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const linkedTotal = showRatios ? `${t.linked} (${percentage(t.linked)})` : t.linked;
  const unlinkedTotal = showRatios ? `${t.unlinked} (${percentage(t.unlinked)})` : t.unlinked;
  const balanceClass = showRatios ? (t.balance4 >= 0n ? " budget-ok" : " budget-exceeded") : "";
  return `<thead><tr><th>Cargo</th><th>Qtd. efetivos</th><th>Valor efetivo</th><th>Qtd. sem vínculo</th><th>Valor sem vínculo</th><th>Qtd. Total</th><th>Valor Total</th></tr></thead><tbody>${body}</tbody><tfoot><tr><th scope="row" class="cargo">Total</th><td class="effective">${linkedTotal}</td><td class="effective">${money(fromDecimal4(linkedPaid4), 4)}</td><td class="unlinked">${unlinkedTotal}</td><td class="unlinked">${money(fromDecimal4(unlinkedPaid4), 4)}</td><td class="total">${t.count}</td><td class="total${balanceClass}">${money(fromDecimal4(t.paid4), 4)}</td></tr></tfoot>`;
}

function renderCsjt() {
  const scenario = currentScenario();
  const summaries = summarizeCsjt(state.data.gratificacoesTodas, state.data.tipos, scenario?.orcamento_paradigma ?? 0);
  $("#csjt-previous-table").innerHTML = csjtTable(summaries.previous);
  $("#csjt-current-table").innerHTML = csjtTable(summaries.current, true);
}

function selectedReportFields() {
  const selected = new Set($$("#report-field-options input:checked").map(input => input.value));
  return REPORT_FIELDS.filter(field => selected.has(field.key));
}

function reportRows() {
  const type = $("#report-type").value;
  const situation = $("#report-situation").value;
  const link = $("#report-link").value;
  const active = $("#report-active").value;
  const unit = $("#report-unit").value;
  const query = $("#report-search").value.trim().toLocaleLowerCase("pt-BR");
  return state.data.gratificacoesTodas.filter(row => {
    const haystack = `${row.servidor_nome ?? ""} ${row.unidade_nome ?? ""} ${row.unidade_sigla ?? ""} ${row.observacoes ?? ""}`.toLocaleLowerCase("pt-BR");
    return (!type || row.tipo_codigo === type)
      && (!situation || row.situacao === situation)
      && (!link || String(row.com_vinculo) === link)
      && (!active || String(row.ativo) === active)
      && (!unit || row.unidade_sigla === unit)
      && (!query || haystack.includes(query));
  });
}
function renderReport() {
  const fields = selectedReportFields();
  const rows = reportRows();
  const total = rows.reduce((sum, row) => sum + Number(row.valor_pago || 0), 0);
  $("#report-status").textContent = `${rows.length} registro${rows.length === 1 ? "" : "s"} · ${money(total, 4)}`;
  if (!fields.length) {
    $("#report-table").innerHTML = `<tbody><tr><td>Selecione ao menos um campo para montar o relatório.</td></tr></tbody>`;
    return;
  }
  $("#report-table").innerHTML = `<thead><tr>${fields.map(field => `<th class="${field.numeric ? "number" : ""}">${field.label}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${fields.map(field => {
    const value = field.format ? field.format(row) : (row[field.key] ?? "-");
    return `<td class="${field.numeric ? "number" : ""}">${escapeHtml(value)}</td>`;
  }).join("")}</tr>`).join("")}</tbody>`;
}

function renderAudit() {
  $("#audit-table").innerHTML = `<thead><tr><th>Data</th><th>Usuário</th><th>Operação</th><th>Entidade</th><th>Registro</th><th>Antes</th><th>Depois</th></tr></thead><tbody>${state.data.auditoria.map(row => `<tr><td>${dateTime(row.created_at)}</td><td>${escapeHtml(row.actor_email || "—")}</td><td>${row.operation}</td><td>${row.entity}</td><td>${row.record_id || "—"}</td><td>${escapeHtml(JSON.stringify(row.old_data) || "—")}</td><td>${escapeHtml(JSON.stringify(row.new_data) || "—")}</td></tr>`).join("")}</tbody>`;
}

function renderProfiles() {
  $("#profiles-table").innerHTML = `<thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Ativo</th><th>Ação</th></tr></thead><tbody>${state.data.perfis.map(row => `<tr data-profile="${row.id}"><td>${escapeHtml(row.nome || "—")}</td><td>${escapeHtml(row.email)}</td><td><select data-field="role">${["admin","gestor","consulta","auditor"].map(role => `<option ${row.role === role ? "selected" : ""}>${role}</option>`).join("")}</select></td><td><input data-field="ativo" type="checkbox" ${row.ativo ? "checked" : ""}></td><td><button data-save-profile="${row.id}">Salvar</button></td></tr>`).join("")}</tbody>`;
}

function populateOptions() {
  const typeOptions = state.data.tipos.map(item => `<option value="${item.codigo}">${item.codigo}</option>`).join("");
  $("#filter-type").insertAdjacentHTML("beforeend", typeOptions);
  $("#report-type").insertAdjacentHTML("beforeend", typeOptions);
  const situationOptions = [...new Set(state.data.gratificacoesTodas.map(row => row.situacao))].sort().map(value => `<option>${escapeHtml(value)}</option>`).join("");
  $("#report-situation").insertAdjacentHTML("beforeend", situationOptions);
  const unitOptions = [...new Map(state.data.gratificacoesTodas.map(row => [row.unidade_sigla, row.unidade_nome])).entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([sigla, nome]) => `<option value="${escapeHtml(sigla)}">${escapeHtml(sigla)} — ${escapeHtml(nome)}</option>`).join("");
  $("#report-unit").insertAdjacentHTML("beforeend", unitOptions);
  $("#report-field-options").innerHTML = REPORT_FIELDS.map((field, index) => `<label><input type="checkbox" value="${field.key}" ${index < 7 ? "checked" : ""}>${field.label}</label>`).join("");
  $("#grant-form [name=tipo_id]").innerHTML = state.data.tipos.map(item => `<option value="${item.id}">${item.codigo}</option>`).join("");
}

function renderAll() { refreshSummary(); renderCards(); renderSummary(); renderGrants(); renderCsjt(); renderReport(); renderAudit(); renderProfiles(); }

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
  $("#reset-password").addEventListener("click", async () => { const email = $("#email").value; if (!email) return toast("Informe seu e-mail.", true); try { await requestPasswordReset(email); showRecoveryCode(email); toast("Código enviado. Consulte o e-mail mais recente."); } catch (error) { toast(error.message, true); } });
  $("#recovery-code-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      await verifyRecoveryCode(event.target.email.value, event.target.code.value);
      clearAuthRedirect(true);
      showPasswordRecovery();
      toast("Código confirmado. Defina sua nova senha.");
    } catch (error) {
      toast(error.code === "otp_expired" ? "Código inválido ou expirado. Solicite um novo código." : error.message, true);
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
  $("#logout").addEventListener("click", async () => { await signOut(); location.reload(); });
  $$('nav button[data-view]').forEach(button => button.addEventListener("click", () => { $$('nav button').forEach(item => item.classList.remove("active")); button.classList.add("active"); $$(".view").forEach(view => view.classList.remove("active-view")); $(`#${button.dataset.view}`).classList.add("active-view"); $("#page-title").textContent = button.textContent; updateNewGrantVisibility(button.dataset.view); }));
  $("#new-grant").addEventListener("click", () => openGrant());
  ["#search","#filter-type","#filter-link"].forEach(selector => $(selector).addEventListener("input", renderGrants));
  ["#report-type","#report-situation","#report-link","#report-active","#report-unit"].forEach(selector => $(selector).addEventListener("change", renderReport));
  $("#report-search").addEventListener("input", renderReport);
  $("#report-field-options").addEventListener("change", renderReport);
  $("#select-all-fields").addEventListener("click", () => { const inputs = $$("#report-field-options input"); const select = inputs.some(input => !input.checked); inputs.forEach(input => { input.checked = select; }); renderReport(); });
  $("#grants-table").addEventListener("click", async event => { const edit = event.target.dataset.edit; const remove = event.target.dataset.delete; if (edit) openGrant(edit); if (remove && confirm("Inativar esta gratificação?")) { try { await inactivateGrant(remove); await reload(); toast("Gratificação inativada."); } catch (error) { toast(error.message, true); } } });
  $("#grant-form").addEventListener("submit", async event => { event.preventDefault(); const form = new FormData(event.target); const record = Object.fromEntries(form); record.com_vinculo = record.com_vinculo === "true"; record.cenario_id = event.target.dataset.scenarioId; try { await saveGrant(record); $("#grant-dialog").close(); await reload(); toast("Gratificação salva."); } catch (error) { toast(error.message, true); } });
  $("#profiles-table").addEventListener("click", async event => { const id = event.target.dataset.saveProfile; if (!id) return; const row = event.target.closest("tr"); try { await updateProfile(id, row.querySelector('[data-field=role]').value, row.querySelector('[data-field=ativo]').checked); await reload(); toast("Perfil atualizado."); } catch (error) { toast(error.message, true); } });
  $("#user-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.target);
    const button = event.submitter;
    button.disabled = true;
    try {
      await inviteUser(form.get("nome"), form.get("email"), form.get("role"));
      event.target.reset();
      await reload();
      toast("Usuário cadastrado. Convite enviado por e-mail.");
    } catch (error) { toast(error.message, true); }
    finally { button.disabled = false; }
  });
  $("#export-csv").addEventListener("click", () => { const fields = selectedReportFields(); if (!fields.length) return toast("Selecione ao menos um campo.", true); const csv = [fields.map(field => field.label).join(";"), ...reportRows().map(row => fields.map(field => { const value = field.format ? field.format(row) : row[field.key]; return `"${String(value ?? "").replaceAll('"','""')}"`; }).join(";"))].join("\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" })); link.download = "gratificacoes-customizado.csv"; link.click(); URL.revokeObjectURL(link.href); });
  $("#print-report").addEventListener("click", () => window.print());
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
}

bindEvents();
if (!isConfigured()) $("#setup-warning").hidden = false;
else {
  handleAuthRedirectError();
  onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" || (passwordRecoveryPending && session)) showPasswordRecovery();
  });
  if (recoveryCodePending) showRecoveryCode();
  if (!passwordRecoveryPending && !recoveryCodePending) start().catch(error => toast(error.message, true));
}
