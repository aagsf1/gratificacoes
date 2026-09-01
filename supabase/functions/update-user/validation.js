export const ALLOWED_ROLES = new Set(["admin", "gestor", "consulta"]);

export function normalizeUpdatePayload(payload = {}) {
  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  const nome = typeof payload.nome === "string" ? payload.nome.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const role = typeof payload.role === "string" ? payload.role.trim() : "";
  const ativo = payload.ativo;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return { error: "Identificador de usuário inválido." };
  if (!nome || nome.length > 160) return { error: "Informe um nome válido com até 160 caracteres." };
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return { error: "Informe um e-mail válido." };
  if (!ALLOWED_ROLES.has(role)) return { error: "Perfil de acesso inválido." };
  if (typeof ativo !== "boolean") return { error: "Situação do usuário inválida." };
  return { value: { userId, nome, email, role, ativo } };
}
