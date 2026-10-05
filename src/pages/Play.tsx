import { useState } from "react";
import { useAuth } from "../lib/auth";
import { useCategories, usePlayers } from "../lib/hooks";
import { navigate } from "../lib/router";
import { rpc } from "../lib/supabase";
import type { Mode } from "../lib/types";
import { ErrorBox, Loading, Page } from "../components/ui";

const modes: { id: Mode; title: string; text: string }[] = [
  { id: "duel", title: "Duell", text: "Ein Freund, dieselben 5 Fragen aus 5 Kategorien. Du spielst zuerst." },
  { id: "challenge", title: "Gruppen-Challenge", text: "Mehrere spielen dieselben 5 Fragen, die beste Runde gewinnt." },
  { id: "solo", title: "Solo-Quiz", text: "5 Fragen aus einer Kategorie zum Üben. Zählt nicht für die Rangliste." },
];

export function PlayPage() {
  const { profile } = useAuth();
  const players = usePlayers();
  const categories = useCategories();
  const [mode, setMode] = useState<Mode>("duel");
  const [picked, setPicked] = useState<string[]>([]);
  const [category, setCategory] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const others = (players.data ?? []).filter((p) => p.id !== profile?.id);

  function toggle(id: string) {
    if (mode === "duel") setPicked([id]);
    else setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  }

  const ready = mode === "solo" ? category != null : mode === "duel" ? picked.length === 1 : picked.length >= 1;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const id = await rpc<number>("create_game", {
        p_mode: mode,
        p_category_id: mode === "solo" ? category : null,
        p_invitees: mode === "solo" ? [] : picked,
      });
      navigate(`/spiel/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Page title="Spielen">
      <div className="segmented" role="tablist" aria-label="Spielmodus">
        {modes.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            className={mode === m.id ? "seg active" : "seg"}
            onClick={() => {
              setMode(m.id);
              setPicked([]);
              setError(null);
            }}
          >
            {m.title}
          </button>
        ))}
      </div>
      <p className="lead">{modes.find((m) => m.id === mode)!.text}</p>

      {mode === "solo" ? (
        <section className="section">
          <h2>Kategorie</h2>
          {categories.loading ? (
            <Loading />
          ) : (
            <div className="choice-grid">
              {(categories.data ?? []).map((c) => (
                <button
                  key={c.id}
                  className={category === c.id ? "choice active" : "choice"}
                  aria-pressed={category === c.id}
                  onClick={() => setCategory(c.id)}
                >
                  <span className="choice-icon" aria-hidden="true">
                    {c.icon}
                  </span>
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="section">
          <div className="section-head">
            <h2>{mode === "duel" ? "Gegner" : "Wer spielt mit?"}</h2>
            {mode === "challenge" && others.length > 0 && (
              <button className="link-btn" onClick={() => setPicked(picked.length === others.length ? [] : others.map((o) => o.id))}>
                {picked.length === others.length ? "Keinen" : "Alle"}
              </button>
            )}
          </div>
          {players.loading ? (
            <Loading />
          ) : others.length === 0 ? (
            <p className="muted">Noch keine anderen Spieler. Der Obmann legt sie im Admin-Bereich an.</p>
          ) : (
            <div className="choice-grid">
              {others.map((p) => (
                <button
                  key={p.id}
                  className={picked.includes(p.id) ? "choice active" : "choice"}
                  aria-pressed={picked.includes(p.id)}
                  onClick={() => toggle(p.id)}
                >
                  <span className="avatar" aria-hidden="true">
                    {p.display_name.slice(0, 1).toUpperCase()}
                  </span>
                  {p.display_name}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <ErrorBox error={error} />
      <div className="sticky-action">
        <button className="btn btn-primary btn-block" disabled={!ready || busy} onClick={start}>
          {busy ? "Fragen werden gezogen …" : mode === "duel" ? "Duell starten" : mode === "challenge" ? "Challenge starten" : "Quiz starten"}
        </button>
      </div>
    </Page>
  );
}
