import assert from "node:assert/strict";
import test from "node:test";
import { consolidatedPresence } from "../presence.js";

test("consolida várias conexões do mesmo usuário", () => {
  const now = Date.parse("2026-08-29T10:06:00.000Z");
  const result = consolidatedPresence([
    { user_id: "a", connected_at: "2026-08-29T10:00:00.000Z", last_seen: "2026-08-29T10:05:00.000Z", current_view: "dashboard" },
    { user_id: "a", connected_at: "2026-08-29T10:01:00.000Z", last_seen: "2026-08-29T10:05:30.000Z", current_view: "relatorios" },
    { user_id: "b", connected_at: "2026-08-29T10:02:00.000Z", last_seen: "2026-08-29T10:05:40.000Z", current_view: "administracao" },
  ], now);

  assert.deepEqual(result, [
    { userId: "a", onlineAt: "2026-08-29T10:00:00.000Z", currentView: "relatorios", connections: 2 },
    { userId: "b", onlineAt: "2026-08-29T10:02:00.000Z", currentView: "administracao", connections: 1 },
  ]);
});

test("ignora presença sem usuário identificado", () => {
  const now = Date.parse("2026-08-29T10:06:00.000Z");
  assert.deepEqual(consolidatedPresence([
    { current_view: "dashboard", last_seen: "2026-08-29T10:05:50.000Z" },
    { user_id: "antigo", connected_at: "2026-08-29T09:00:00.000Z", last_seen: "2026-08-29T09:59:00.000Z" },
  ], now), []);
});
