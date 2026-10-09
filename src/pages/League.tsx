import { useState } from "react";
import { useAuth } from "../lib/auth";
import { useLoad, useOnVisible } from "../lib/hooks";
import { seconds } from "../lib/format";
import { navigate } from "../lib/router";
import { rpc } from "../lib/supabase";
import type { League, LeagueRound, LeagueStatus } from "../lib/types";
import { Icon } from "../components/Icon";
import { ErrorBox, Loading, Page, toast } from "../components/ui";

const DAY = { weekday: "short", day: "numeric", month: "numeric" } as const;

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("de-DE", DAY);
}
function weekend(l: League) {
  const sat = new Date(l.starts_at);
  const sun = new Date(sat.getTime() + 86400e3);
  return `${sat.toLocaleDateString("de-DE", { day: "numeric", month: "numeric" })}–${sun.toLocaleDateString("de-DE", { day: "numeric", month: "numeric" })}`;
}
function pts(n: number | null | undefined) {
  return (n ?? 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

function roundLabel(r: LeagueRound, n: { quiz: number }) {
  if (r.kind === "quiz") return `Quiz ${n.quiz}`;
  if (r.kind === "music") return r.hard ? "Musik · Hard" : "Musik";
  return r.hard ? "Bilder · Hard" : "Bilder · Easy";
}
function roundHref(r: LeagueRound) {
  return r.kind === "music" ? `/musik/${r.game_id}` : r.kind === "bild" ? `/bilder/${r.game_id}` : `/spiel/${r.game_id}`;
}

/** Kachel für die Startseite */
export function LeagueCard() {
  const st = useLoad(() => rpc<LeagueStatus>("league_status"));
  useOnVisible(() => st.reload());
  const l = st.data?.current;
  if (!l) return null;
  const played = l.rounds.filter((r) => r.my_status === "done").length;
  let line = "";
  let cta = "";
  if (l.phase === "signup") {
    line = l.joined
      ? `Du bist dabei · ${l.members.length} angemeldet · los geht's Samstag`
      : `Anmeldung bis ${fmtDay(new Date(new Date(l.signup_until).getTime() - 60000).toISOString())} 23:59 · ${l.members.length} dabei`;
    cta = l.joined ? "Ansehen" : "Anmelden";
  } else if (l.phase === "running") {
    if (!l.joined) line = `Läuft · ${l.members.length} spielen mit`;
    else if (l.rounds.length === 0) line = "Fällt aus, zu wenige Anmeldungen";
    else line = `${played} von ${l.rounds.length} Runden gespielt · bis Sonntag 23:59`;
    cta = l.joined && played < l.rounds.length && l.rounds.length > 0 ? "Weiterspielen" : "Ansehen";
  } else {
    line = "Beendet";
    cta = "Ergebnis";
  }
  return (
    <button className={`league-card${l.phase === "running" && l.joined && played < l.rounds.length ? " is-live" : ""}`} onClick={() => navigate("/liga")}>
      <span className="league-badge" aria-hidden="true">
        <Icon name="trophy" size={22} />
      </span>
      <span className="league-text">
        <strong>Weekend League {weekend(l)}</strong>
        <span>{line}</span>
      </span>
      <span className="pill pill-brass">{cta}</span>
    </button>
  );
}

export function LeaguePage() {
  const { profile } = useAuth();
  const st = useLoad(() => rpc<LeagueStatus>("league_status"));
  useOnVisible(() => st.reload());
  const [busy, setBusy] = useState(false);

  async function join(on: boolean) {
    setBusy(true);
    try {
      await rpc("league_join", { p_join: on });
      toast(on ? "Du bist dabei!" : "Abgemeldet.");
      st.reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (st.loading && !st.data) return <Loading />;
  if (!st.data)
    return (
      <Page title="Weekend League" back={() => navigate("/")}>
        <ErrorBox error={st.error ?? "Nicht gefunden."} retry={st.reload} />
      </Page>
    );

  const l = st.data.current;
  const me = profile!.id;
  let quiz = 0;
  const myTotal = l.standings.find((s) => s.user_id === me);

  return (
    <Page title="Weekend League" back={() => navigate("/")}>
      <p className="lead">
        Wochenende {weekend(l)}: alle gegen alle. 3 Quizrunden, 2 Bilderrunden, 2 Musikrunden, spielen wann du willst bis Sonntag 23:59.
      </p>

      {l.phase === "signup" && (
        <section className="section league-signup">
          <p>
            {l.joined ? (
              <>
                <strong>Du bist angemeldet.</strong> Am Samstag um 0 Uhr gehen die Runden auf, du bekommst einen Push.
              </>
            ) : (
              <>Anmeldung bis {fmtDay(new Date(new Date(l.signup_until).getTime() - 60000).toISOString())} 23:59.</>
            )}
          </p>
          <button className={l.joined ? "btn btn-ghost btn-block" : "btn btn-primary btn-block btn-big"} disabled={busy} onClick={() => join(!l.joined)}>
            {l.joined ? "Doch nicht mitspielen" : "Ich bin dabei"}
          </button>
        </section>
      )}

      {l.phase !== "signup" && l.joined && l.rounds.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Deine Runden</h2>
            {myTotal && (
              <span className="muted small">
                {pts(myTotal.points)} von 35 Punkten · Platz {myTotal.rank}
              </span>
            )}
          </div>
          <ul className="league-rounds">
            {l.rounds.map((r) => {
              if (r.kind === "quiz") quiz += 1;
              const done = r.my_status === "done";
              const open = l.phase === "running" && !done && r.game_id;
              return (
                <li key={r.position}>
                  <button className={`league-round${done ? " is-done" : ""}`} disabled={!r.game_id} onClick={() => r.game_id && navigate(roundHref(r))}>
                    <Icon name={r.kind === "quiz" ? "play" : r.kind === "music" ? "music" : "face"} size={20} />
                    <span className="league-round-name">{roundLabel(r, { quiz })}</span>
                    {done ? (
                      <span className="league-round-pts">
                        {pts(r.my_points)}
                        <span className="muted">/5</span>
                      </span>
                    ) : open ? (
                      <span className="pill pill-brass">Spielen</span>
                    ) : (
                      <span className="muted small">{l.phase === "done" ? "verpasst" : "–"}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {l.phase !== "signup" && l.rounds.length === 0 && (
        <div className="notice">Diese League fällt aus, es hatten sich weniger als zwei Leute angemeldet.</div>
      )}

      <Standings league={l} me={me} title={l.phase === "signup" ? "Angemeldet" : l.phase === "running" ? "Zwischenstand" : "Endstand"} />

      {st.data.last && st.data.last.standings.length > 0 && l.phase !== "done" && (
        <Standings league={st.data.last} me={me} title={`Letzte League (${weekend(st.data.last)})`} compact />
      )}

      <section className="section">
        <h2>So funktioniert's</h2>
        <ul className="rules">
          <li>Anmelden von Montag bis Freitag 23:59, gespielt wird Samstag und Sonntag.</li>
          <li>Alle Angemeldeten bekommen dieselben 7 Runden: 3× Quiz, Bilder Easy und Hard, Musik Normal und Hard.</li>
          <li>Jede Runde zählt höchstens 5 Punkte (Musik wird halbiert), zusammen 35.</li>
          <li>Bei Gleichstand entscheidet die Gesamtzeit. Was nach Sonntag 23:59 gespielt wird, zählt nicht.</li>
          <li>Die League zählt nicht für die normale Rangliste und nicht für das Tageslimit.</li>
        </ul>
      </section>
    </Page>
  );
}

function Standings({ league, me, title, compact }: { league: League; me: string; title: string; compact?: boolean }) {
  if (league.phase === "signup") {
    return (
      <section className="section">
        <h2>
          {title} <span className="muted small">({league.members.length})</span>
        </h2>
        {league.members.length === 0 ? (
          <p className="muted">Noch niemand. Sei der Erste!</p>
        ) : (
          <div className="chips">
            {league.members.map((m) => (
              <span key={m.user_id} className={m.user_id === me ? "chip active" : "chip"}>
                {m.display_name}
              </span>
            ))}
          </div>
        )}
      </section>
    );
  }
  const rows = compact ? league.standings.slice(0, 3) : league.standings;
  return (
    <section className="section">
      <h2>{title}</h2>
      <table className="board">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Name</th>
            <th scope="col" className="num">
              Punkte
            </th>
            <th scope="col" className="num">
              Runden
            </th>
            <th scope="col" className="num">
              Zeit
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.user_id} className={s.user_id === me ? "me" : ""}>
              <td>{s.rank}</td>
              <td>{s.display_name}</td>
              <td className="num points">{pts(s.points)}</td>
              <td className="num">{s.rounds}/7</td>
              <td className="num">{seconds(s.total_ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
