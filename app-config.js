export const APP_CONFIG = Object.freeze({
  supabaseUrl: "https://wiollbxstffanegwdiod.supabase.co",
  supabasePublishableKey: "sb_publishable_SjOu7y0JKQMz0NwmIUnCoA_cDFIcYcx",
});

export function isConfigured() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(APP_CONFIG.supabaseUrl)
    && !APP_CONFIG.supabaseUrl.includes("SEU-PROJETO")
    && APP_CONFIG.supabasePublishableKey.length > 20
    && !APP_CONFIG.supabasePublishableKey.includes("SUA_CHAVE");
}
