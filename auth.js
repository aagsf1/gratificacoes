import { getSupabase } from "./supabase-client.js?v=20260829-admin";

export async function signIn(email, password) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Configure o Supabase em app-config.js.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await getSupabase()?.auth.signOut() ?? {};
  if (error) throw error;
}

export async function requestPasswordReset(email) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Configure o Supabase em app-config.js.");
  const redirectTo = new URL(window.location.pathname, window.location.origin).href;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function verifyAccessCode(email, token, type = "recovery") {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Configure o Supabase em app-config.js.");
  if (!["invite", "recovery"].includes(type)) throw new Error("Tipo de código de acesso inválido.");
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type,
  });
  if (error) throw error;
  return data;
}

export async function updatePassword(password) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Configure o Supabase em app-config.js.");
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  return data;
}

export async function currentIdentity() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id,email,nome,role,ativo")
    .eq("id", session.user.id)
    .single();
  if (error) throw error;
  if (!profile.ativo) throw new Error("Usuário inativo.");
  return { session, profile };
}

export function onAuthStateChange(callback) {
  return getSupabase()?.auth.onAuthStateChange((event, session) => callback(event, session));
}
