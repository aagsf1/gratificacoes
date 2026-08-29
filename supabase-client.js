import { APP_CONFIG, isConfigured } from "./app-config.js";

let client;

export function getSupabase() {
  if (!isConfigured()) return null;
  if (!client) {
    if (!window.supabase?.createClient) throw new Error("Biblioteca Supabase não carregada.");
    client = window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}
