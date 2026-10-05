// Push-Benachrichtigungen (Web Push mit VAPID).
//   GET  → liefert den öffentlichen Schlüssel für die App
//   POST → von der Datenbank aufgerufen (Header x-push-secret), schickt an user_ids
//
// Secrets (Supabase → Edge Functions → Secrets):
//   VAPID_KEYS   JSON aus dem Admin-Bereich der App („Push einrichten“)
//   PUSH_SECRET  beliebiger langer Text, identisch mit app_config.push_secret
//   PUSH_CONTACT optional, z. B. mailto:du@example.com
import * as webpush from "jsr:@negrel/webpush@^0.5.0";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

let appServerPromise: Promise<{ server: webpush.ApplicationServer; publicKey: string }> | null = null;

function getAppServer() {
  if (!appServerPromise) {
    appServerPromise = (async () => {
      const raw = Deno.env.get("VAPID_KEYS");
      if (!raw) throw new Error("VAPID_KEYS fehlt in den Edge-Function-Secrets.");
      const vapidKeys = await webpush.importVapidKeys(JSON.parse(raw), { extractable: false });
      const server = await webpush.ApplicationServer.new({
        contactInformation: Deno.env.get("PUSH_CONTACT") ?? "mailto:admin@obmanns-kinder.example",
        vapidKeys,
      });
      const publicKey = await webpush.exportApplicationServerKey(vapidKeys);
      return { server, publicKey };
    })();
    appServerPromise.catch(() => (appServerPromise = null));
  }
  return appServerPromise;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method === "GET") {
      const { publicKey } = await getAppServer();
      return json({ publicKey });
    }

    if (req.method !== "POST") return json({ error: "Nicht erlaubt." }, 405);

    const secret = Deno.env.get("PUSH_SECRET");
    if (!secret || req.headers.get("x-push-secret") !== secret) {
      return json({ error: "Falsches Push-Secret." }, 401);
    }

    const { user_ids, title, body, url } = await req.json();
    if (!Array.isArray(user_ids) || user_ids.length === 0) return json({ sent: 0 });

    const { data: subs, error } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", user_ids);
    if (error) throw error;

    const { server } = await getAppServer();
    const payload = JSON.stringify({ title, body, url: url ?? "/" });
    let sent = 0;
    const gone: number[] = [];

    await Promise.all(
      (subs ?? []).map(async (s) => {
        try {
          await server
            .subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } })
            .pushTextMessage(payload, { ttl: 60 * 60 * 24, urgency: webpush.Urgency.Normal });
          sent++;
        } catch (err) {
          if (err instanceof webpush.PushMessageError && (err.isGone() || err.response.status === 404)) {
            gone.push(s.id);
          } else {
            console.error("Push fehlgeschlagen", s.endpoint.slice(0, 60), String(err));
          }
        }
      }),
    );

    if (gone.length) await admin.from("push_subscriptions").delete().in("id", gone);
    return json({ sent, removed: gone.length });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
