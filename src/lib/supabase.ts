import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && key);

export const supabase = createClient(url ?? "https://example.supabase.co", key ?? "missing", {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "obmanns-kinder-auth" },
});

// Benutzernamen werden intern auf diese Fantasie-Domain abgebildet.
// Muss mit USERNAME_DOMAIN in supabase/functions/admin-users/index.ts übereinstimmen.
export const USERNAME_DOMAIN = "obmanns-kinder.example";

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${USERNAME_DOMAIN}`;
}

/** Fehlermeldung aus Supabase/Postgres für Menschen lesbar machen. */
export function errorText(err: unknown): string {
  if (!err) return "Unbekannter Fehler.";
  const msg = typeof err === "string" ? err : (err as { message?: string }).message ?? String(err);
  if (/Invalid login credentials/i.test(msg)) return "Benutzername oder Passwort stimmt nicht.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Keine Verbindung. Prüf dein Internet und versuch es nochmal.";
  if (/JWT expired/i.test(msg)) return "Deine Anmeldung ist abgelaufen. Bitte neu anmelden.";
  if (/answers_distinct/i.test(msg)) return "Die vier Antworten müssen sich unterscheiden.";
  if (/violates check constraint/i.test(msg)) return "Ein Feld ist zu lang oder leer.";
  return msg;
}

/** RPC aufrufen und Fehler als Exception werfen. */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) throw new Error(errorText(error));
  return data as T;
}

/** Edge Function aufrufen und Fehlermeldung aus dem Body holen. */
export async function invoke<T>(fn: string, body?: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body: body as Record<string, unknown> });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = await ctx.json();
        if (j?.error) msg = j.error;
      } catch {
        /* Body war kein JSON */
      }
    }
    throw new Error(msg);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}
