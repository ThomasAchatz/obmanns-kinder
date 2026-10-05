import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { LogoTarget } from "../components/Target";

export function LoginPage() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(username, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="login-mark">
        <LogoTarget size={96} />
      </div>
      <h1 className="login-title">Obmanns Kinder</h1>
      <p className="login-sub">Das Quiz unter uns.</p>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Benutzername</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />
        </label>
        <label className="field">
          <span>Passwort</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Anmelden …" : "Anmelden"}
        </button>
        <p className="muted small">Kein Zugang oder Passwort vergessen? Melde dich beim Obmann.</p>
      </form>
    </main>
  );
}
