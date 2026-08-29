export const APP_CONFIG = Object.freeze({
  supabaseUrl: "https://SEU-PROJETO.supabase.co",
  supabasePublishableKey: "SUA_CHAVE_PUBLICAVEL",
});

export function isConfigured() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(APP_CONFIG.supabaseUrl)
    && !APP_CONFIG.supabaseUrl.includes("SEU-PROJETO")
    && APP_CONFIG.supabasePublishableKey.length > 20
    && !APP_CONFIG.supabasePublishableKey.includes("SUA_CHAVE");
}
