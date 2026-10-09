import { useState } from "react";
import { useAuth } from "../lib/auth";
import { useCategories, useLoad, usePlayers } from "../lib/hooks";
import { navigate } from "../lib/router";
import { rpc } from "../lib/supabase";
import type { BildCounts, DayStatus, Kind, Mode, SongCounts } from "../lib/types";
import { SPARTEN } from "../lib/format";
import { Icon } from "../components/Icon";
import { ErrorBox, Loading, Page } from "../components/ui";

const musicText: Record<Mode, string> = {
  duel: "Ein Freund, dieselben 5 Songs. Erst den Interpreten erraten, dann den Titel. Du hörst zuerst.",
  challenge: "Mehrere hören dieselben 5 Songs, die meisten Punkte gewinnen.",
  solo: "5 Songs quer durch alle Jahrzehnte zum Üben. Zählt nicht für die Rangliste.",
};

const bildText: Record<Mode, string> = {
  duel: "Ein Freund, dieselben 5 Gesichter. Easy: vier Namen zur Auswahl. Du rätst zuerst.",
  challenge: "Mehrere raten dieselben 5 Gesichter, die meisten Treffer gewinnen.",
  solo: "5 Gesichter zum Üben. Zählt nicht für die Rangliste.",
};

const modes: { id: Mode; title: string; text: string }[] = [
  { id: "duel", title: "Duell", text: "Ein Freund, dieselben 5 Fragen. Du spielst zuerst." },
  { id: "challenge", title: "Gruppe", text: "Mehrere spielen dieselben 5 Fragen, die beste Runde gewinnt." },
  { id: "solo", title: "Solo", text: "5 Fragen zum Üben, aus deinen Lieblingskategorien oder gemischt. Zählt nicht für die Rangliste." },
];

export function PlayPage() {
  const { profile } = useAuth();
  const players = usePlayers();
  const categories = useCategories();
  const [kind, setKind] = useState<Kind>(() =>
    window.location.hash.includes("art=musik") ? "music" : window.location.hash.includes("art=bilder") ? "bild" : "quiz",
  );
  const day = useLoad(() => rpc<DayStatus>("my_day_status", { p_kind: kind }), [kind]);
  const songs = useLoad(() => rpc<SongCounts>("song_counts"));
  const faces = useLoad(() => rpc<BildCounts>("bild_counts"));
  const [sparten, setSparten] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("duel");
  const [hard, setHard] = useState(() => window.location.hash.includes("hard=1"));
  const [picked, setPicked] = useState<string[]>([]);
  const [cats, setCats] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const others = (players.data ?? []).filter((p) => p.id !== profile?.id);

  function toggle(id: string) {
    if (mode === "duel") setPicked([id]);
    else setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  }

  const ready = mode === "solo" ? true : mode === "duel" ? picked.length === 1 : picked.length >= 1;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      if (kind === "bild") {
        const id = await rpc<number>("create_bild_game", {
          p_mode: mode,
          p_invitees: mode === "solo" ? [] : picked,
          p_hard: hard,
          p_sparten: sparten.length ? sparten : null,
        });
        navigate(`/bilder/${id}`);
        return;
      }
      if (kind === "music") {
        const id = await rpc<number>("create_music_game", { p_mode: mode, p_invitees: mode === "solo" ? [] : picked, p_hard: hard });
        navigate(`/musik/${id}`);
        return;
      }
      const id = await rpc<number>("create_game", {
        p_mode: mode,
        p_category_ids: cats.length ? cats : null,
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
      <div className="kind-switch kind-switch-3" role="tablist" aria-label="Spielart">
        {(["quiz", "music", "bild"] as Kind[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            className={kind === k ? "kind active" : "kind"}
            onClick={() => {
              setKind(k);
              setError(null);
            }}
          >
            <Icon name={k === "quiz" ? "play" : k === "music" ? "music" : "face"} size={20} />
            <span className="kind-name">{k === "quiz" ? "Quiz" : k === "music" ? "Musik" : "Bilder"}</span>
            <span className="kind-sub">
              {k === "quiz"
                ? "Wissensfragen"
                : k === "music"
                  ? songs.data
                    ? `${songs.data.total} Songs`
                    : "Interpret, Titel"
                  : faces.data
                    ? `${faces.data.total} Gesichter`
                    : "Wer ist das?"}
            </span>
          </button>
        ))}
      </div>
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
      {kind !== "quiz" && (
        <div className="level-row">
          <span className="level-label">Schwierigkeit</span>
          <div className="segmented segmented-small" role="tablist" aria-label="Schwierigkeit">
            <button role="tab" aria-selected={!hard} className={!hard ? "seg active" : "seg"} onClick={() => setHard(false)}>
              {kind === "bild" ? "Easy" : "Normal"}
            </button>
            <button role="tab" aria-selected={hard} className={hard ? "seg active" : "seg"} onClick={() => setHard(true)}>
              Hard
            </button>
          </div>
        </div>
      )}
      <p className="lead">
        {kind === "bild"
          ? hard
            ? bildText[mode].replace("Easy: vier Namen zur Auswahl.", "Hard: Namen selbst tippen, 30 Sekunden pro Gesicht.")
            : bildText[mode]
          : kind === "music"
          ? hard
            ? musicText[mode].replace("Erst den Interpreten erraten, dann den Titel.", "Keine Antworten zur Auswahl: Song selbst eintippen, 45 Sekunden pro Song.")
            : musicText[mode]
          : modes.find((m) => m.id === mode)!.text}
      </p>
      {mode !== "solo" && day.data && day.data.counted_games >= day.data.limit_games && (
        <div className="notice">
          Du hast heute schon {day.data.limit_games} {kind === "music" ? "Musik-Wertungsspiele" : kind === "bild" ? "Bilder-Wertungsspiele" : "Wertungsspiele"}. Weitere Spiele machen Spaß, bringen aber bis morgen keine Punkte.
        </div>
      )}

      {mode !== "solo" && (
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

      {kind === "quiz" && (
        <section className="section">
          <h2>Kategorien</h2>
          {categories.loading ? (
            <Loading />
          ) : (
            <div className="chips" role="group" aria-label="Kategorien">
              <button className={cats.length === 0 ? "chip active" : "chip"} aria-pressed={cats.length === 0} onClick={() => setCats([])}>
                <span aria-hidden="true">🎲</span> Zufall
              </button>
              {(categories.data ?? []).map((c) => (
                <button
                  key={c.id}
                  className={cats.includes(c.id) ? "chip active" : "chip"}
                  aria-pressed={cats.includes(c.id)}
                  onClick={() => setCats((x) => (x.includes(c.id) ? x.filter((y) => y !== c.id) : [...x, c.id]))}
                >
                  <span aria-hidden="true">{c.icon}</span> {c.name}
                </button>
              ))}
            </div>
          )}
          <p className="muted small chips-hint">
            {cats.length === 0
              ? "5 Fragen aus 5 zufälligen Kategorien."
              : cats.length === 1
                ? `Alle 5 Fragen aus ${categories.data?.find((c) => c.id === cats[0])?.name ?? "dieser Kategorie"}.`
                : cats.length >= 5
                  ? `5 Fragen aus 5 deiner ${cats.length} Kategorien.`
                  : `5 Fragen, verteilt auf deine ${cats.length} Kategorien.`}
          </p>
        </section>
      )}

      {kind === "bild" && (
        <section className="section">
          <h2>Wer kommt dran?</h2>
          <div className="chips" role="group" aria-label="Sparten">
            <button className={sparten.length === 0 ? "chip active" : "chip"} aria-pressed={sparten.length === 0} onClick={() => setSparten([])}>
              Alle
            </button>
            {SPARTEN.map((s) => (
              <button
                key={s}
                className={sparten.includes(s) ? "chip active" : "chip"}
                aria-pressed={sparten.includes(s)}
                onClick={() => setSparten((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))}
              >
                {s}
              </button>
            ))}
          </div>
          <p className="muted small chips-hint">
            {sparten.length === 0
              ? "Etwa zwei Drittel Frauen, gemischt aus allen Jahrzehnten seit 1970."
              : `Nur ${sparten.join(", ")}. Etwa zwei Drittel Frauen.`}
          </p>
        </section>
      )}

      <ErrorBox error={error} />
      <div className="sticky-action">
        <button className="btn btn-primary btn-block" disabled={!ready || busy} onClick={start}>
          {busy
            ? kind === "music"
              ? "Songs werden gemischt …"
              : kind === "bild"
                ? "Gesichter werden gemischt …"
                : "Fragen werden gezogen …"
            : kind === "bild"
              ? (mode === "duel" ? "Bilder-Duell starten" : mode === "challenge" ? "Bilder-Challenge starten" : "Gesichter raten") +
                (hard ? " (Hard)" : "")
              : kind === "music"
              ? (mode === "duel" ? "Musik-Duell starten" : mode === "challenge" ? "Musik-Challenge starten" : "Songs anhören") +
                (hard ? " (Hard)" : "")
              : mode === "duel"
                ? "Duell starten"
                : mode === "challenge"
                  ? "Challenge starten"
                  : "Quiz starten"}
        </button>
      </div>
    </Page>
  );
}
