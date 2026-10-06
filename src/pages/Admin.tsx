import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { clearCategoryCache, useLoad } from "../lib/hooks";
import { generateVapidKeys, randomSecret } from "../lib/push";
import { navigate } from "../lib/router";
import { errorText, invoke, supabase } from "../lib/supabase";
import type { Category } from "../lib/types";
import { ErrorBox, Loading, Page, toast } from "../components/ui";

type AdminUser = { id: string; username: string; display_name: string; is_admin: boolean; blocked: boolean; last_sign_in_at: string | null };
type Report = {
  id: number;
  reason: string;
  comment: string | null;
  created_at: string;
  question: { id: number; text: string; correct: string; is_active: boolean } | null;
  reporter: { display_name: string } | null;
};

function makePassword() {
  const words = ["Brezn", "Maßkrug", "Obmann", "Weißwurst", "Gaudi", "Radi", "Dult", "Schützen"];
  const w = words[Math.floor(Math.random() * words.length)];
  return `${w}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export function AdminPage() {
  const { profile } = useAuth();
  if (!profile?.is_admin) {
    return (
      <Page title="Admin" back={() => navigate("/profil")}>
        <p>Dieser Bereich ist nur für den Obmann.</p>
      </Page>
    );
  }
  return (
    <Page title="Admin" back={() => navigate("/profil")}>
      <Users />
      <Reports />
      <Categories />
      <PushSetup />
    </Page>
  );
}

function Users() {
  const users = useLoad(() => invoke<{ users: AdminUser[] }>("admin-users", { action: "list" }).then((r) => r.users));
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState(makePassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await invoke("admin-users", { action: "create", username, display_name: displayName, password });
      setCreated(`Zugang für ${displayName || username}: Benutzername „${username.toLowerCase()}“, Passwort „${password}“`);
      setUsername("");
      setDisplayName("");
      setPassword(makePassword());
      users.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(u: AdminUser) {
    const pw = prompt(`Neues Passwort für ${u.display_name} (mind. 8 Zeichen):`, makePassword());
    if (!pw) return;
    try {
      await invoke("admin-users", { action: "reset_password", user_id: u.id, password: pw });
      setCreated(`Neues Passwort für ${u.display_name}: „${pw}“`);
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function toggleBlock(u: AdminUser) {
    if (!confirm(u.blocked ? `${u.display_name} wieder freischalten?` : `${u.display_name} sperren? Die Person kann sich dann nicht mehr anmelden.`)) return;
    try {
      await invoke("admin-users", { action: "set_blocked", user_id: u.id, blocked: !u.blocked });
      users.reload();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <section className="section">
      <h2>Spieler</h2>
      <ErrorBox error={users.error} retry={users.reload} />
      {users.loading && !users.data ? (
        <Loading />
      ) : (
        <ul className="admin-list">
          {(users.data ?? []).map((u) => (
            <li key={u.id}>
              <div>
                <p className="strong">
                  {u.display_name} {u.is_admin && <span className="pill">Obmann</span>} {u.blocked && <span className="pill pill-red">gesperrt</span>}
                </p>
                <p className="muted small">
                  {u.username} · {u.last_sign_in_at ? `zuletzt ${new Date(u.last_sign_in_at).toLocaleDateString("de-DE")}` : "noch nie angemeldet"}
                </p>
              </div>
              <div className="admin-actions">
                <button className="btn btn-small btn-ghost" onClick={() => resetPassword(u)}>
                  Passwort
                </button>
                {!u.is_admin && (
                  <button className="btn btn-small btn-ghost" onClick={() => toggleBlock(u)}>
                    {u.blocked ? "Freischalten" : "Sperren"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {created && (
        <div className="notice" role="status">
          <p>{created}</p>
          <p className="small">Schick die Zugangsdaten am besten direkt weiter, angezeigt werden sie nur jetzt.</p>
          <button className="btn btn-small" onClick={() => navigator.clipboard?.writeText(created).then(() => toast("Kopiert."))}>
            Kopieren
          </button>
        </div>
      )}

      <form className="form card" onSubmit={create}>
        <h3>Neuen Spieler anlegen</h3>
        <label className="field">
          <span>Benutzername (zum Anmelden)</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))}
            pattern="[a-z0-9._\-]{2,24}"
            autoCapitalize="none"
            required
          />
        </label>
        <label className="field">
          <span>Anzeigename</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={30} placeholder="z. B. Sepp" />
        </label>
        <label className="field">
          <span>Passwort</span>
          <input value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </label>
        <ErrorBox error={error} />
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Anlegen …" : "Spieler anlegen"}
        </button>
      </form>
    </section>
  );
}

function Reports() {
  const reports = useLoad(async () => {
    const { data, error } = await supabase
      .from("question_reports")
      .select("id, reason, comment, created_at, question:questions!question_reports_question_id_fkey(id, text, correct, is_active), reporter:profiles!question_reports_user_id_fkey(display_name)")
      .eq("status", "offen")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data as unknown as Report[];
  });

  async function resolve(r: Report, pause: boolean) {
    if (pause && r.question) {
      const { error } = await supabase.from("questions").update({ is_active: false }).eq("id", r.question.id);
      if (error) return toast(errorText(error));
    }
    const { error } = await supabase.from("question_reports").update({ status: "erledigt" }).eq("id", r.id);
    if (error) return toast(errorText(error));
    reports.reload();
  }

  return (
    <section className="section">
      <h2>Gemeldete Fragen</h2>
      <ErrorBox error={reports.error} retry={reports.reload} />
      {reports.loading && !reports.data ? (
        <Loading />
      ) : (reports.data ?? []).length === 0 ? (
        <p className="muted">Keine offenen Meldungen.</p>
      ) : (
        <ul className="admin-list">
          {reports.data!.map((r) => (
            <li key={r.id} className="report">
              <div>
                <p className="strong">{r.question?.text}</p>
                <p className="small">Lösung: {r.question?.correct}</p>
                <p className="muted small">
                  {r.reporter?.display_name}: {r.reason}
                  {r.comment ? ` · „${r.comment}“` : ""}
                </p>
              </div>
              <div className="admin-actions">
                <button className="btn btn-small btn-ghost" onClick={() => r.question && navigate(`/fragen/${r.question.id}`)}>
                  Bearbeiten
                </button>
                <button className="btn btn-small btn-ghost" onClick={() => resolve(r, true)}>
                  Pausieren
                </button>
                <button className="btn btn-small" onClick={() => resolve(r, false)}>
                  Erledigt
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Categories() {
  const cats = useLoad(async () => {
    const { data, error } = await supabase.from("categories").select("id, name, icon, sort_order").order("sort_order");
    if (error) throw error;
    return data as Category[];
  });
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("❓");

  async function save(c: Category, patch: Partial<Category>) {
    const { error } = await supabase.from("categories").update(patch).eq("id", c.id);
    if (error) return toast(errorText(error));
    clearCategoryCache();
    cats.reload();
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const max = Math.max(0, ...(cats.data ?? []).map((c) => c.sort_order));
    const { error } = await supabase.from("categories").insert({ name: name.trim(), icon: icon.trim() || "❓", sort_order: max + 1 });
    if (error) return toast(errorText(error));
    setName("");
    setIcon("❓");
    clearCategoryCache();
    cats.reload();
  }

  return (
    <section className="section">
      <h2>Kategorien</h2>
      {cats.loading && !cats.data ? (
        <Loading />
      ) : (
        <ul className="admin-list">
          {(cats.data ?? []).map((c) => (
            <li key={c.id} className="cat-edit">
              <input className="cat-icon" defaultValue={c.icon} aria-label="Symbol" onBlur={(e) => e.target.value !== c.icon && save(c, { icon: e.target.value })} />
              <input defaultValue={c.name} aria-label="Name" onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && save(c, { name: e.target.value.trim() })} />
            </li>
          ))}
        </ul>
      )}
      <form className="cat-edit" onSubmit={add}>
        <input className="cat-icon" value={icon} onChange={(e) => setIcon(e.target.value)} aria-label="Symbol" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Neue Kategorie" required minLength={2} />
        <button className="btn btn-small">Hinzufügen</button>
      </form>
      <p className="muted small">Änderungen werden beim Verlassen des Feldes gespeichert.</p>
    </section>
  );
}

function PushSetup() {
  const [keys, setKeys] = useState<{ secretJson: string; publicKey: string; pushSecret: string } | null>(null);
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/push`;

  async function make() {
    const k = await generateVapidKeys();
    setKeys({ ...k, pushSecret: randomSecret() });
  }

  const sql = keys
    ? `insert into public.app_config (key, value) values\n  ('push_url', '${url}'),\n  ('push_secret', '${keys.pushSecret}')\non conflict (key) do update set value = excluded.value;`
    : "";

  return (
    <section className="section">
      <h2>Push einrichten</h2>
      <p className="muted small">Nur einmal nötig. Die Schlüssel werden hier im Browser erzeugt und nirgends gespeichert.</p>
      {!keys ? (
        <button className="btn" onClick={make}>
          Schlüssel erzeugen
        </button>
      ) : (
        <ol className="setup-steps">
          <li>
            <p>
              In Supabase unter <strong>Edge Functions → Secrets</strong> anlegen: <code>VAPID_KEYS</code> mit diesem Wert:
            </p>
            <textarea readOnly rows={4} value={keys.secretJson} onFocus={(e) => e.target.select()} />
          </li>
          <li>
            <p>
              Ebenfalls dort: <code>PUSH_SECRET</code> mit diesem Wert:
            </p>
            <input readOnly value={keys.pushSecret} onFocus={(e) => e.target.select()} />
          </li>
          <li>
            <p>
              Im <strong>SQL Editor</strong> ausführen:
            </p>
            <textarea readOnly rows={4} value={sql} onFocus={(e) => e.target.select()} />
          </li>
          <li>
            <p>Danach im Profil die Benachrichtigungen einschalten.</p>
          </li>
        </ol>
      )}
    </section>
  );
}
