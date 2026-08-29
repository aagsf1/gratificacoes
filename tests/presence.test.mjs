import assert from "node:assert/strict";
import test from "node:test";
import { consolidatedPresence } from "../presence.js";

test("consolida várias conexões do mesmo usuário", () => {
  const result = consolidatedPresence({
    userA: [
      { user_id: "a", online_at: "2026-08-29T10:00:00.000Z", current_view: "dashboard" },
      { user_id: "a", online_at: "2026-08-29T10:05:00.000Z", current_view: "relatorios" },
    ],
    userB: [
      { user_id: "b", online_at: "2026-08-29T10:02:00.000Z", current_view: "administracao" },
    ],
  });

  assert.deepEqual(result, [
    { userId: "a", onlineAt: "2026-08-29T10:00:00.000Z", currentView: "relatorios", connections: 2 },
    { userId: "b", onlineAt: "2026-08-29T10:02:00.000Z", currentView: "administracao", connections: 1 },
  ]);
});

test("ignora presença sem usuário identificado", () => {
  assert.deepEqual(consolidatedPresence({ anonymous: [{ current_view: "dashboard" }] }), []);
});
