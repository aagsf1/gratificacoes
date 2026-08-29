import { getSupabase } from "./supabase-client.js?v=20260829-admin";

let channel;
let subscribed = false;
let currentPayload;
let syncCallback;
let statusCallback;

export function consolidatedPresence(presenceState) {
  const users = new Map();
  for (const entries of Object.values(presenceState ?? {})) {
    for (const entry of entries) {
      if (!entry?.user_id) continue;
      const previous = users.get(entry.user_id);
      const onlineAt = entry.online_at || new Date().toISOString();
      users.set(entry.user_id, {
        userId: entry.user_id,
        onlineAt: previous?.onlineAt && previous.onlineAt < onlineAt ? previous.onlineAt : onlineAt,
        currentView: entry.current_view || previous?.currentView || "dashboard",
        connections: (previous?.connections ?? 0) + 1,
      });
    }
  }
  return [...users.values()].sort((a, b) => a.onlineAt.localeCompare(b.onlineAt));
}

export function startPresence(identity, onSync, onStatus) {
  const supabase = getSupabase();
  if (!supabase || channel) return;
  syncCallback = onSync;
  statusCallback = onStatus;
  currentPayload = {
    user_id: identity.session.user.id,
    online_at: new Date().toISOString(),
    current_view: "dashboard",
  };
  channel = supabase.channel("online-users", {
    config: { private: true, presence: { key: identity.session.user.id } },
  });
  channel
    .on("presence", { event: "sync" }, () => {
      syncCallback?.(consolidatedPresence(channel.presenceState()));
    })
    .subscribe(async status => {
      if (status === "SUBSCRIBED") {
        subscribed = true;
        const result = await channel.track(currentPayload);
        statusCallback?.(result === "ok" ? "connected" : "error");
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        subscribed = false;
        statusCallback?.("error");
      }
    });
}

export async function updatePresence(currentView) {
  if (!channel || !subscribed || !currentPayload) return;
  currentPayload = { ...currentPayload, current_view: currentView };
  await channel.track(currentPayload);
}

export async function stopPresence() {
  if (!channel) return;
  const supabase = getSupabase();
  if (subscribed) await channel.untrack();
  await supabase?.removeChannel(channel);
  channel = undefined;
  subscribed = false;
  currentPayload = undefined;
}
