import { useState } from "react";
import { useLoad } from "../lib/hooks";
import { timeAgo } from "../lib/format";
import { rpc } from "../lib/supabase";
import { ErrorBox, Loading } from "./ui";

// Überblick für den Obmann: wer nutzt die App, wer spielt mit wem, wer gewinnt.

type PlayerStat = {
  user_id: string;
  display_name: string;
  last_sign_in_at: string | null;
  last_played_at: string | null;
  games: number;
  quiz: number;
  music: number;
  duels: number;
  challenges: number;
  solo: number;
  duel_wins: number;
  duel_draws: number;
  duel_losses: number;
  open_games: number;
  questions: number;
  facts: number;
  songs: number;
  weeks: number[];
};
type PairStat = { a_id: string; a_name: string; b_id: string; b_name: string; games: number; duels: number; a_wins: number; b_wins: number; last_at: string };
type Stats = {
  days: number | null;
  totals: { games: number; quiz: number; music: number; active_players: number };
  players: PlayerStat[];
  pairs: PairStat[];
};

const DAY = 86400e3;

function activity(p: PlayerStat): { cls: string; label: string } {
  if (!p.last_played_at) return p.last_sign_in_at ? { cls: "is-idle", label: "angemeldet, nie gespielt" } : { cls: "is-never", label: "noch nie angemeldet" };
  const age = Date.now() - new Date(p.last_played_at).getTime();
  if (age <= 7 * DAY) return { cls: "is-active", label: "aktiv" };
  if (age <= 30 * DAY) return { cls: "is-rare", label: "selten" };
  return { cls: "is-idle", label: "inaktiv" };
}

function Weeks({ weeks }: { weeks: number[] }) {
  const max = Math.max(1, ...weeks);
  return (
    <span className="weeks" role="img" aria-label={`Spiele der letzten 8 Wochen: ${weeks.join(", ")}`}>
      {weeks.map((n, i) => (
        <span key={i} className={n ? "week" : "week is-zero"} style={{ height: n ? `${Math.max(3, (n / max) * 20)}px` : undefined }} title={`${i === 7 ? "Diese Woche" : `Vor ${7 - i} Wo.`}: ${n} Spiele`} />
      ))}
    </span>
  );
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function AdminStats() {
  const [days, setDays] = useState<number | null>(30);
  const stats = useLoad(() => rpc<Stats>("admin_stats", { p_days: days }), [days]);
  const [allPairs, setAllPairs] = useState(false);
  const s = stats.data;

  const active = s?.players.filter((p) => activity(p).cls === "is-active").length ?? 0;
  const pairs = s ? (allPairs ? s.pairs : s.pairs.slice(0, 8)) : [];

  return (
    <section className="section">
      <div className="section-head">
        <h2>Wer spielt?</h2>
        <div className="segmented segmented-small" role="tablist" aria-label="Zeitraum">
          <button role="tab" aria-selected={days === 30} className={days === 30 ? "seg active" : "seg"} onClick={() => setDays(30)}>
            30 Tage
          </button>
          <button role="tab" aria-selected={days === null} className={days === null ? "seg active" : "seg"} onClick={() => setDays(null)}>
            Gesamt
          </button>
        </div>
      </div>
      <ErrorBox error={stats.error} retry={stats.reload} />
      {stats.loading && !s ? (
        <Loading />
      ) : s ? (
        <>
          <dl className="stat-row">
            <div>
              <dt>Spiele</dt>
              <dd>{s.totals.games}</dd>
            </div>
            <div>
              <dt>davon Musik</dt>
              <dd>{s.totals.music}</dd>
            </div>
            <div>
              <dt>Aktiv</dt>
              <dd>
                {active}
                <span className="stat-of">/{s.players.length}</span>
              </dd>
            </div>
          </dl>

          <ul className="stat-players">
            {s.players.map((p) => {
              const a = activity(p);
              const extra = [
                p.quiz && plural(p.quiz, "Quiz", "Quiz"),
                p.music && `${p.music} Musik`,
                p.solo && `${p.solo} solo`,
                p.questions && plural(p.questions, "Frage", "Fragen"),
                p.facts && plural(p.facts, "Wissen-Post", "Wissen-Posts"),
                p.songs && plural(p.songs, "Song", "Songs"),
              ].filter(Boolean);
              return (
                <li key={p.user_id} className="stat-player">
                  <span className={`act-dot ${a.cls}`} aria-hidden="true" />
                  <div className="stat-main">
                    <p className="stat-name">
                      {p.display_name}
                      <span className="stat-act">{a.label}</span>
                    </p>
                    <p className="stat-line">
                      {p.duels > 0 && (
                        <>
                          Duelle {p.duel_wins}–{p.duel_losses}
                          {p.duel_draws ? ` (${p.duel_draws} unentsch.)` : ""} ·{" "}
                        </>
                      )}
                      {p.last_played_at ? `gespielt ${timeAgo(p.last_played_at)}` : "noch kein Spiel"}
                      {p.open_games > 0 && ` · ${p.open_games} offen`}
                    </p>
                    {extra.length > 0 && <p className="stat-extra">{extra.join(" · ")}</p>}
                  </div>
                  <div className="stat-side">
                    <span className="stat-games">{p.games}</span>
                    <Weeks weeks={p.weeks} />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="muted small">
            Grün: in den letzten 7 Tagen gespielt, gelb: in 30 Tagen, Kreis: länger nicht oder nie. Zahl rechts: beendete Spiele im
            Zeitraum. Balken: Spiele pro Woche der letzten 8 Wochen, rechts die aktuelle.
          </p>

          <h3 className="stat-sub">Wer mit wem</h3>
          {s.pairs.length === 0 ? (
            <p className="muted">Noch keine gemeinsamen Spiele im Zeitraum.</p>
          ) : (
            <>
              <ul className="stat-pairs">
                {pairs.map((p) => (
                  <li key={p.a_id + p.b_id}>
                    <span className="pair-names">
                      {p.a_name} <span className="muted">&</span> {p.b_name}
                    </span>
                    <span className="pair-games">{plural(p.games, "Spiel", "Spiele")}</span>
                    <span className="pair-score">
                      {p.duels > 0 ? (
                        <>
                          {p.a_wins}:{p.b_wins}
                          <span className="muted"> im Duell</span>
                        </>
                      ) : (
                        <span className="muted">nur Gruppe</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {s.pairs.length > 8 && (
                <button className="link-btn" onClick={() => setAllPairs((x) => !x)}>
                  {allPairs ? "Weniger anzeigen" : `Alle ${s.pairs.length} Paare anzeigen`}
                </button>
              )}
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
