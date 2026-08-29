import { getSupabase } from "./supabase-client.js?v=20260829-presence-v2";

const HEARTBEAT_INTERVAL_MS = 25_000;
const ONLINE_WINDOW_MS = 90_000;
const ADMIN_REFRESH_MS = 10_000;

let heartbeatTimer;
let refreshTimer;
let sessionId;
let currentPayload;
let syncCallback;
let statusCallback;
let canListUsers = false;
let heartbeatInFlight = false;

export function consolidatedPresence(rows, now = Date.now(), onlineWindowMs = ONLINE_WINDOW_MS) {
  const users = new Map();
  for (const row of rows ?? []) {
    const lastSeen = Date.parse(row?.last_seen);
    if (!row?.user_id || !Number.isFinite(lastSeen) || now - lastSeen > onlineWindowMs) continue;
    const previous = users.get(row.user_id);
    const onlineAt = row.connected_at || row.last_seen;
    users.set(row.user_id, {
      userId: row.user_id,
      onlineAt: previous?.onlineAt && previous.onlineAt < onlineAt ? previous.onlineAt : onlineAt,
      currentView: lastSeen >= (previous?.lastSeen ?? 0) ? (row.current_view || "dashboard") : previous.currentView,
      connections: (previous?.connections ?? 0) + 1,
      lastSeen: Math.max(previous?.lastSeen ?? 0, lastSeen),
    });
  }
  return [...users.values()]
    .sort((a, b) => a.onlineAt.localeCompare(b.onlineAt))
    .map(({ lastSeen: _lastSeen, ...entry }) => entry);
}

async function refreshOnlineUsers() {
  if (!canListUsers) return;
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
  const { data, error } = await getSupabase()
    .from("user_presence")
    .select("session_id,user_id,current_view,connected_at,last_seen")
    .gte("last_seen", cutoff)
    .order("connected_at", { ascending: true });
  if (error) throw error;
  syncCallback?.(consolidatedPresence(data));
}

async function heartbeat() {
  if (!currentPayload || heartbeatInFlight || document.visibilityState === "hidden") return;
  heartbeatInFlight = true;
  try {
    const { error } = await getSupabase().from("user_presence").upsert({
      ...currentPayload,
      last_seen: new Date().toISOString(),
    }, { onConflict: "session_id" });
    if (error) throw error;
    await refreshOnlineUsers();
    statusCallback?.("connected");
  } catch (error) {
    console.error("Falha ao registrar presença:", error);
    statusCallback?.("error");
  } finally {
    heartbeatInFlight = false;
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === "visible") void heartbeat();
}

export function startPresence(identity, onSync, onStatus) {
  if (!getSupabase() || currentPayload) return;
  syncCallback = onSync;
  statusCallback = onStatus;
  canListUsers = identity.profile.role === "admin";
  sessionId = crypto.randomUUID();
  currentPayload = {
    session_id: sessionId,
    user_id: identity.session.user.id,
    connected_at: new Date().toISOString(),
    current_view: "dashboard",
  };
  statusCallback?.("connecting");
  void heartbeat();
  heartbeatTimer = window.setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
  if (canListUsers) refreshTimer = window.setInterval(() => void refreshOnlineUsers().catch(error => {
    console.error("Falha ao consultar usuários online:", error);
    statusCallback?.("error");
  }), ADMIN_REFRESH_MS);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("online", heartbeat);
}

export async function updatePresence(currentView) {
  if (!currentPayload) return;
  currentPayload = { ...currentPayload, current_view: currentView };
  await heartbeat();
}

export async function stopPresence() {
  window.clearInterval(heartbeatTimer);
  window.clearInterval(refreshTimer);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("online", heartbeat);
  const id = sessionId;
  heartbeatTimer = undefined;
  refreshTimer = undefined;
  sessionId = undefined;
  currentPayload = undefined;
  syncCallback = undefined;
  statusCallback = undefined;
  canListUsers = false;
  if (id) await getSupabase()?.from("user_presence").delete().eq("session_id", id);
}
