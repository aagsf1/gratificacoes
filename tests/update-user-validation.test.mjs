import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUpdatePayload } from "../supabase/functions/update-user/validation.js";

const valid = {
  userId: "123e4567-e89b-42d3-a456-426614174000",
  nome: "  Maria da Silva  ",
  email: "  MARIA@EXAMPLE.COM  ",
  role: "gestor",
  ativo: true,
};

test("normaliza nome e e-mail sem alterar o identificador", () => {
  assert.deepEqual(normalizeUpdatePayload(valid), {
    value: {
      userId: valid.userId,
      nome: "Maria da Silva",
      email: "maria@example.com",
      role: "gestor",
      ativo: true,
    },
  });
});

test("rejeita identificador, nome, e-mail, perfil e situação inválidos", () => {
  for (const mutation of [
    { userId: "inválido" },
    { nome: " " },
    { email: "sem-arroba" },
    { role: "auditor" },
    { ativo: "true" },
  ]) assert.ok(normalizeUpdatePayload({ ...valid, ...mutation }).error);
});

test("aceita somente os três perfis vigentes", () => {
  for (const role of ["admin", "gestor", "consulta"]) {
    assert.equal(normalizeUpdatePayload({ ...valid, role }).value.role, role);
  }
});
