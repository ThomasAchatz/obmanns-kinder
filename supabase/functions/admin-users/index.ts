// Spieler verwalten – nur für Admins.
// Aktionen: list, create, reset_password, set_blocked
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

// Muss mit USERNAME_DOMAIN in src/lib/supabase.ts übereinstimmen.
const USERNAME_DOMAIN = "obmanns-kinder.example";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

function cleanUsername(raw: unknown): string {
  const name = String(raw ?? "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,24}$/.test(name)) {
    throw new Error("Benutzername: 2–24 Zeichen, nur a–z, 0–9, Punkt, Minus, Unterstrich.");
  }
  return name;
}

function checkPassword(raw: unknown): string {
  const pw = String(raw ?? "");
  if (pw.length < 8) throw new Error("Das Passwort braucht mindestens 8 Zeichen.");
  return pw;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Wer ruft auf? Muss ein Admin sein.
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: userData } = await admin.auth.getUser(token);
    if (!userData.user) return json({ error: "Nicht angemeldet." }, 401);

    const { data: me } = await admin.from("profiles").select("is_admin").eq("id", userData.user.id).single();
    if (!me?.is_admin) return json({ error: "Nur für Admins." }, 403);

    const body = await req.json();

    switch (body.action) {
      case "list": {
        const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
        if (error) throw error;
        const { data: profiles } = await admin.from("profiles").select("id, username, display_name, is_admin");
        const users = (profiles ?? []).map((p) => {
          const u = data.users.find((x) => x.id === p.id);
          const bannedUntil = (u as { banned_until?: string } | undefined)?.banned_until;
          return {
            ...p,
            last_sign_in_at: u?.last_sign_in_at ?? null,
            blocked: !!bannedUntil && new Date(bannedUntil) > new Date(),
          };
        });
        users.sort((a, b) => a.display_name.localeCompare(b.display_name, "de"));
        return json({ users });
      }

      case "create": {
        const username = cleanUsername(body.username);
        const password = checkPassword(body.password);
        const displayName = String(body.display_name ?? "").trim() || username;
        const { data, error } = await admin.auth.admin.createUser({
          email: `${username}@${USERNAME_DOMAIN}`,
          password,
          email_confirm: true,
          user_metadata: { username, display_name: displayName },
        });
        if (error) {
          if (/already|exists|registered/i.test(error.message)) {
            throw new Error(`Den Benutzernamen „${username}“ gibt es schon.`);
          }
          throw error;
        }
        return json({ id: data.user.id });
      }

      case "reset_password": {
        const password = checkPassword(body.password);
        const { error } = await admin.auth.admin.updateUserById(String(body.user_id), { password });
        if (error) throw error;
        return json({ ok: true });
      }

      case "set_blocked": {
        if (body.user_id === userData.user.id) throw new Error("Du kannst dich nicht selbst sperren.");
        const { error } = await admin.auth.admin.updateUserById(String(body.user_id), {
          ban_duration: body.blocked ? "876000h" : "none",
        });
        if (error) throw error;
        return json({ ok: true });
      }

      default:
        return json({ error: "Unbekannte Aktion." }, 400);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});
