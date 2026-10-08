import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { audio, playClip, stopClip, unlockAudio } from "../lib/audio";
import { useLoad } from "../lib/hooks";
import { musicModeLabel, seconds } from "../lib/format";
import { navigate } from "../lib/router";
import { invoke, rpc } from "../lib/supabase";
import type { CurrentSong, MusicGameDetails, SongPick, SongResult } from "../lib/types";
import { Icon } from "../components/Icon";
import { Record, type Groove } from "../components/Record";
import { HardAnswer } from "../components/HardAnswer";
import { ErrorBox, Loading, Page, toast } from "../components/ui";

const LETTERS = ["A", "B", "C", "D"];

export function MusicGamePage({ id }: { id: number }) {
  const details = useLoad(() => rpc<MusicGameDetails>("music_game_details", { p_game_id: id }), [id]);
  const [playing, setPlaying] = useState(false);
  const { reload } = details;
  const finished = useCallback(() => {
    stopClip();
    setPlaying(false);
    reload();
  }, [reload]);

  useEffect(() => {
    if (details.data?.can_play && details.data.started) setPlaying(true);
  }, [details.data]);
  useEffect(() => () => stopClip(), []);

  if (details.loading && !details.data) return <Loading />;
  if (details.error || !details.data)
    return (
      <Page title="Musik" back={() => navigate("/")}>
        <ErrorBox error={details.error ?? "Spiel nicht gefunden."} retry={details.reload} />
      </Page>
    );

  const g = details.data;
  if (playing && g.can_play) return <MusicPlayer game={g} onFinished={finished} />;
  if (g.can_play)
    return (
      <MusicIntro
        game={g}
        onStart={() => {
          unlockAudio();
          setPlaying(true);
        }}
      />
    );
  return <MusicResult game={g} reload={details.reload} />;
}

function MusicIntro({ game, onStart }: { game: MusicGameDetails; onStart: () => void }) {
  const { profile } = useAuth();
  const others = game.players.filter((p) => p.user_id !== profile!.id);
  const creator = game.players.find((p) => p.user_id === game.created_by);
  return (
    <Page title={musicModeLabel[game.mode] + (game.hard ? " · Hard" : "")} back={() => navigate("/")}>
      <div className="intro">
        <Record size={170} label="Leere Platte" />
        {game.mode === "duel" && (
          <p className="lead">
            {game.created_by === profile!.id
              ? `Du forderst ${others[0]?.display_name} heraus. Du hörst zuerst, dann bekommt ${others[0]?.display_name} dieselben Songs.`
              : `${creator?.display_name} hat die Songs schon gehört. Jetzt bist du dran.`}
          </p>
        )}
        {game.mode === "challenge" && (
          <p className="lead">Musik-Challenge von {creator?.display_name} mit {game.players.length} Leuten. Alle hören dieselben Songs.</p>
        )}
        {game.mode === "solo" && <p className="lead">5 Songs quer durch alle Jahrzehnte zum Üben.</p>}
        {game.hard ? (
          <ul className="rules">
            <li>Hard-Mode: keine Antworten zur Auswahl</li>
            <li>Tipp Titel oder Interpret, dann wähl den Song aus der Liste</li>
            <li>45 Sekunden pro Song, je ein Punkt für Interpret und Titel</li>
            <li>Ton an! Kopfhörer helfen.</li>
          </ul>
        ) : (
          <ul className="rules">
            <li>5 Songs, je 30 Sekunden Ausschnitt</li>
            <li>Erst „Wer singt?“, dann „Welcher Titel?“, je ein Punkt</li>
            <li>Ton an! Kopfhörer helfen.</li>
          </ul>
        )}
        <button className="btn btn-primary btn-block btn-big" onClick={onStart}>
          Los geht's
        </button>
      </div>
    </Page>
  );
}

function MusicPlayer({ game, onFinished }: { game: MusicGameDetails; onFinished: () => void }) {
  const [song, setSong] = useState<CurrentSong | null>(null);
  const [result, setResult] = useState<SongResult | null>(null);
  const [artist, setArtist] = useState<number | null>(null);
  const [title, setTitle] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(30);
  const [sound, setSound] = useState<"loading" | "playing" | "paused" | "blocked">("loading");
  const [tally, setTally] = useState<Groove[]>([]);
  const [pick, setPick] = useState<SongPick | null>(null);
  const endAt = useRef(0);
  const submitting = useRef(false);
  const refreshed = useRef(false);

  const start = useCallback(async (s: CurrentSong) => {
    if (!s.preview_url) {
      setSound("blocked");
      return;
    }
    setSound("loading");
    const ok = await playClip(s.preview_url, (s.seconds ?? 30) - s.seconds_left);
    setSound(ok ? "playing" : "blocked");
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setSong(null);
    setResult(null);
    setArtist(null);
    setTitle(null);
    setPick(null);
    submitting.current = false;
    refreshed.current = false;
    stopClip();
    try {
      const next = await rpc<CurrentSong | { done: true }>("music_next", { p_game_id: game.id });
      if (next.done) {
        onFinished();
        return;
      }
      setSong(next);
      endAt.current = Date.now() + next.seconds_left * 1000;
      setRemaining(next.seconds_left);
      start(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [game.id, onFinished, start]);

  useEffect(() => {
    load();
  }, [load]);

  // Abspielstatus vom Audio-Element übernehmen; defekten Vorschau-Link einmal erneuern
  useEffect(() => {
    const a = audio();
    const onPlay = () => setSound("playing");
    const onPause = () => setSound((x) => (x === "playing" ? "paused" : x));
    const onError = async () => {
      if (!song || refreshed.current || a.src.startsWith("data:")) return;
      refreshed.current = true;
      try {
        const r = await invoke<{ preview_url: string }>("music", { action: "refresh", song_id: song.song_ref });
        const ok = await playClip(r.preview_url, Math.max(0, (song.seconds ?? 30) - (endAt.current - Date.now()) / 1000));
        setSound(ok ? "playing" : "blocked");
      } catch {
        setSound("blocked");
        toast("Dieser Song spielt gerade nicht. Rate trotzdem oder warte die Zeit ab.");
      }
    };
    a.addEventListener("playing", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("error", onError);
    return () => {
      a.removeEventListener("playing", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("error", onError);
    };
  }, [song]);

  const submit = useCallback(
    async (a: number | null, t: number | null, guess?: SongPick | null) => {
      if (!song || submitting.current) return;
      submitting.current = true;
      try {
        const r = song.hard
          ? await rpc<SongResult>("music_answer_hard", {
              p_game_id: game.id,
              p_position: song.position,
              p_artist: guess?.artist ?? null,
              p_title: guess?.title ?? null,
            })
          : await rpc<SongResult>("music_answer", {
              p_game_id: game.id,
              p_position: song.position,
              p_artist: a !== null && a >= 0 ? a : null,
              p_title: t,
            });
        setResult(r);
        setTally((x) => {
          const n = [...x];
          n[r.position - 1] = { artist: r.artist_ok, title: r.title_ok };
          return n;
        });
        if (navigator.vibrate) navigator.vibrate(r.artist_ok && r.title_ok ? 30 : r.artist_ok || r.title_ok ? 20 : [60, 40, 60]);
      } catch (e) {
        setError((e as Error).message);
        submitting.current = false;
      }
    },
    [song, game.id],
  );

  // Countdown
  const choice = useRef({ artist, title, pick });
  choice.current = { artist, title, pick };
  useEffect(() => {
    if (!song || result) return;
    const t = setInterval(() => {
      const left = Math.max(0, (endAt.current - Date.now()) / 1000);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(t);
        submit(choice.current.artist, choice.current.title, choice.current.pick);
      }
    }, 100);
    return () => clearInterval(t);
  }, [song, result, submit]);

  function pickTitle(i: number) {
    setTitle(i);
    submit(artist, i);
  }

  function toggleSound() {
    if (!song?.preview_url) return;
    const a = audio();
    if (sound === "playing") a.pause();
    else start({ ...song, seconds_left: Math.max(0, (endAt.current - Date.now()) / 1000) });
  }

  if (error)
    return (
      <Page title={musicModeLabel[game.mode] + (game.hard ? " · Hard" : "")} back={() => navigate("/")}>
        <ErrorBox error={error} retry={load} />
      </Page>
    );
  if (!song) return <Loading text="Platte wird aufgelegt …" />;

  const total = song.seconds ?? 30;
  const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
  const urgent = remaining <= 8 && !result;
  const stage: "hard" | "artist" | "title" | "done" = result ? "done" : song.hard ? "hard" : artist === null ? "artist" : "title";
  const points = result ? Number(result.artist_ok) + Number(result.title_ok) : 0;

  return (
    <main className={result ? "play music-play has-next" : "play music-play"}>
      <div className="play-top">
        <button
          className="icon-btn"
          aria-label="Zurück zum Start"
          onClick={() => {
            stopClip();
            navigate("/");
          }}
        >
          <Icon name="back" />
        </button>
        <div className="play-progress" aria-label={`Song ${song.position} von 5`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={n < song.position ? "dot done" : n === song.position ? "dot now" : "dot"} />
          ))}
        </div>
        <span className={urgent ? "play-seconds urgent" : "play-seconds"} aria-live="off">
          {result ? "" : Math.ceil(remaining)}
        </span>
      </div>
      <div className="timer" aria-hidden="true">
        <div className={urgent ? "timer-fill urgent" : "timer-fill"} style={{ width: `${result ? 0 : pct}%` }} />
      </div>

      <div className={song.hard && !result ? "turntable is-compact" : "turntable"}>
        <button
          className="turntable-disc"
          onClick={toggleSound}
          aria-label={sound === "playing" ? "Pause" : "Abspielen"}
          disabled={!song.preview_url}
        >
          <Record
            size={result ? 132 : song.hard ? 76 : 176}
            spinning={sound === "playing"}
            grooves={tally}
            current={result ? undefined : song.position}
            artwork={null}
            label={result ? `${result.artist} – ${result.title}` : "Plattenteller"}
          />
          {!result && sound !== "playing" && (
            <span className="turntable-btn" aria-hidden="true">
              <Icon name={sound === "loading" ? "music" : "playTri"} filled={sound !== "loading"} size={26} />
            </span>
          )}
        </button>
        {!result && (
          <p className="turntable-hint">
            {sound === "blocked"
              ? "Tippe auf die Platte, um den Song zu starten."
              : sound === "loading"
                ? "Song lädt …"
                : sound === "paused"
                  ? "Pausiert, die Zeit läuft weiter."
                  : `Song ${song.position} von 5`}
          </p>
        )}
      </div>

      {stage === "hard" && (
        <HardAnswer
          pick={pick}
          onPick={setPick}
          onSubmit={() => submit(null, null, pick)}
          onSkip={() => submit(null, null, null)}
        />
      )}

      {stage === "artist" && (
        <section aria-label="Wer singt?">
          <h1 className="play-question music-question">Wer singt?</h1>
          <div className="answers">
            {song.artist_options.map((opt, i) => (
              <button key={i} className="answer" onClick={() => setArtist(i)}>
                <span className="answer-letter" aria-hidden="true">
                  {LETTERS[i]}
                </span>
                <span>{opt}</span>
              </button>
            ))}
          </div>
          <div className="play-tools">
            <button className="link-btn" onClick={() => setArtist(-1)}>
              Weiß ich nicht, gleich zum Titel
            </button>
          </div>
        </section>
      )}

      {stage === "title" && (
        <section aria-label="Welcher Titel?">
          <p className="music-chosen">
            <span className="muted">Interpret:</span> {artist! >= 0 ? song.artist_options[artist!] : "weiß nicht"}
            <button className="link-btn" onClick={() => setArtist(null)} disabled={title !== null}>
              ändern
            </button>
          </p>
          <h1 className="play-question music-question">Welcher Titel?</h1>
          <div className="answers">
            {song.title_options.map((opt, i) => (
              <button key={i} className={title === i ? "answer picked" : "answer"} disabled={title !== null} onClick={() => pickTitle(i)}>
                <span className="answer-letter" aria-hidden="true">
                  {LETTERS[i]}
                </span>
                <span>{opt}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {result && (
        <section className={points === 2 ? "reveal reveal-hit" : points === 1 ? "reveal reveal-half" : "reveal reveal-miss"} aria-live="polite">
          <h2>{points === 2 ? "Volltreffer!" : points === 1 ? "Halb richtig" : result.timed_out ? "Zeit abgelaufen" : "Daneben"}</h2>
          <div className="music-reveal-head">
            {result.artwork_url && <img src={result.artwork_url} alt="" />}
            <p className="music-answer">
              <strong>{result.artist}</strong>
              <span>{result.title}</span>
            </p>
          </div>
          <ul className="music-checks">
            <li className={result.artist_ok ? "good" : "bad"}>
              {result.artist_ok ? "✓" : "✗"} Interpret
              {!result.artist_ok && artist !== null && artist >= 0 && <span className="muted"> · du: {song.artist_options[artist]}</span>}
              {!result.artist_ok && song.hard && pick && <span className="muted"> · du: {pick.artist}</span>}
            </li>
            <li className={result.title_ok ? "good" : "bad"}>
              {result.title_ok ? "✓" : "✗"} Titel
              {!result.title_ok && title !== null && <span className="muted"> · du: {song.title_options[title]}</span>}
              {!result.title_ok && song.hard && pick && <span className="muted"> · du: {pick.title}</span>}
            </li>
          </ul>
          <p className="muted small">+{points} {points === 1 ? "Punkt" : "Punkte"} · Der Song läuft weiter, bis du weitertippst.</p>
        </section>
      )}
      {result && (
        <div className="play-next">
          <button className="btn btn-primary btn-block btn-big" onClick={() => (result.finished ? onFinished() : load())}>
            {result.finished ? "Zum Ergebnis" : "Nächster Song"}
          </button>
        </div>
      )}
    </main>
  );
}

function groovesFor(game: MusicGameDetails, userId: string): Groove[] {
  return game.songs.map((s) => {
    const a = s.answers[userId];
    return a ? { artist: !!a.artist_ok, title: !!a.title_ok } : null;
  });
}

function MusicResult({ game, reload }: { game: MusicGameDetails; reload: () => void }) {
  const { profile } = useAuth();
  const me = profile!.id;
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState<number | null>(null);
  const mine = game.players.find((p) => p.user_id === me)!;
  const done = game.players.filter((p) => p.status === "done");
  const pending = game.players.filter((p) => p.status === "pending");
  const revealed = game.songs.length > 0;

  useEffect(() => {
    const a = audio();
    const off = () => setListening(null);
    a.addEventListener("ended", off);
    return () => {
      a.removeEventListener("ended", off);
      stopClip();
    };
  }, []);

  async function listen(pos: number, url: string | null) {
    if (!url) return;
    if (listening === pos) {
      stopClip();
      setListening(null);
      return;
    }
    unlockAudio();
    setListening(pos);
    if (!(await playClip(url))) setListening(null);
  }

  async function action(fn: "nudge" | "close_challenge", okText: string) {
    setBusy(true);
    try {
      await rpc(fn, { p_game_id: game.id });
      toast(okText);
      reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  let headline = "";
  if (game.mode === "duel") {
    const other = game.players.find((p) => p.user_id !== me);
    if (game.status === "open") headline = other?.status === "pending" ? `Warten auf ${other.display_name}` : "Du bist dran";
    else if (mine.rank === 1 && other?.rank === 1) headline = "Unentschieden";
    else if (mine.rank === 1) headline = mine.score === other?.score ? "Gewonnen, nach Zeit!" : "Gewonnen!";
    else headline = mine.score === other?.score ? "Verloren, nach Zeit" : "Verloren";
  } else if (game.mode === "challenge") {
    headline = game.status === "open" ? `${done.length} von ${game.players.length} haben gehört` : `Platz ${mine.rank ?? "–"}`;
  } else {
    headline = `${mine.score ?? 0} von 10 Punkten`;
  }

  return (
    <Page title={musicModeLabel[game.mode] + (game.hard ? " · Hard" : "")} back={() => navigate("/")}>
      <h2 className="result-headline">{headline}</h2>
      {game.mode !== "solo" && game.status !== "open" && game.my_points && (
        <p className={game.my_points.counted ? "points-note" : "points-note is-off"}>
          {game.my_points.counted
            ? `+${game.my_points.points} ${game.my_points.points === 1 ? "Punkt" : "Punkte"} für die Musik-Rangliste · Wertungsspiel ${game.my_points.day_index} von 3 heute`
            : game.my_points.day_index
              ? `Keine Punkte: Dieses Spiel war dein ${game.my_points.day_index}. Musikspiel an diesem Tag, es zählen nur die ersten 3.`
              : "Keine Punkte: Es hat nur eine Person gespielt."}
        </p>
      )}

      {game.mode === "duel" ? (
        <div className="duel-board">
          {[mine, ...game.players.filter((p) => p.user_id !== me)].map((p) => (
            <div key={p.user_id} className="duel-side">
              <Record grooves={revealed ? groovesFor(game, p.user_id) : []} size={140} dim={p.status !== "done"} />
              <p className="duel-name">{p.user_id === me ? "Du" : p.display_name}</p>
              <p className="duel-score">
                {p.score ?? "–"}
                <span className="duel-of">/10</span>
              </p>
              <p className="muted small">{p.status === "done" ? seconds(p.total_ms) : "hört noch"}</p>
            </div>
          ))}
          {revealed && <p className="muted small duel-legend">Jede Rille ist ein Song, außen der erste. Oben leuchtet der Interpret, unten der Titel.</p>}
        </div>
      ) : game.mode === "solo" ? (
        <div className="solo-board">
          <Record grooves={groovesFor(game, me)} size={180} />
          <p className="muted small">Jede Rille ist ein Song: oben leuchtet der Interpret, unten der Titel.</p>
          <MusicAgainButton hard={!!game.hard} />
        </div>
      ) : (
        <ol className="ranking">
          {done.map((p) => (
            <li key={p.user_id} className={p.user_id === me ? "me" : ""}>
              <span className="rank">{p.rank}.</span>
              <Record grooves={revealed ? groovesFor(game, p.user_id) : []} size={44} />
              <span className="ranking-name">{p.user_id === me ? "Du" : p.display_name}</span>
              <span className="ranking-score">
                {p.score} <span className="muted small">· {seconds(p.total_ms)}</span>
              </span>
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.user_id} className="pending">
              <span className="rank">–</span>
              <Record size={44} dim />
              <span className="ranking-name">{p.display_name}</span>
              <span className="muted small">{game.status === "open" ? "hört noch" : "nicht gespielt"}</span>
            </li>
          ))}
        </ol>
      )}

      {(game.can_nudge || game.can_close) && (
        <div className="row-actions">
          {game.can_nudge && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => action("nudge", "Angestupst!")}>
              Anstupsen
            </button>
          )}
          {game.can_close && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => action("close_challenge", "Challenge geschlossen.")}>
              Challenge schließen
            </button>
          )}
        </div>
      )}

      {revealed && (
        <section className="section">
          <h2>Die Songs</h2>
          <ol className="song-list">
            {game.songs.map((s) => {
              const my = s.answers[me];
              const others = game.players.filter((p) => p.user_id !== me && s.answers[p.user_id]);
              return (
                <li key={s.position} className="song-row">
                  <button
                    className={listening === s.position ? "song-cover is-playing" : "song-cover"}
                    onClick={() => listen(s.position, s.preview_url)}
                    aria-label={listening === s.position ? "Anhören stoppen" : `${s.title} anhören`}
                  >
                    {s.artwork_url ? <img src={s.artwork_url} alt="" loading="lazy" /> : <Icon name="music" />}
                    <span className="song-cover-btn">
                      <Icon name={listening === s.position ? "pause" : "playTri"} filled size={16} />
                    </span>
                  </button>
                  <div className="song-meta">
                    <p className="song-title">{s.title}</p>
                    <p className="song-artist">{s.artist}</p>
                    <p className="song-marks small">
                      {my ? (
                        <>
                          <span className={my.artist_ok ? "good" : "bad"}>{my.artist_ok ? "✓" : "✗"} Interpret</span>
                          <span className={my.title_ok ? "good" : "bad"}>{my.title_ok ? "✓" : "✗"} Titel</span>
                        </>
                      ) : null}
                    </p>
                    {others.length > 0 && (
                      <p className="small review-others">
                        {others.map((p) => {
                          const a = s.answers[p.user_id];
                          const n = Number(!!a.artist_ok) + Number(!!a.title_ok);
                          return (
                            <span key={p.user_id} className={n === 2 ? "good" : n === 0 ? "bad" : ""}>
                              {p.display_name} {n}/2
                            </span>
                          );
                        })}
                      </p>
                    )}
                    {game.hard && my && (my.guess_title || my.guess_artist) && !(my.artist_ok && my.title_ok) && (
                      <p className="muted small">
                        Dein Tipp: {my.guess_title} – {my.guess_artist}
                      </p>
                    )}
                    {s.added_by && <p className="muted small">Song von {s.added_by}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="muted small">Vorschau: Apple Music</p>
        </section>
      )}

      {game.mode !== "solo" && game.status !== "open" && (
        <button className="btn btn-primary btn-block" onClick={() => navigate(game.hard ? "/spielen?art=musik&hard=1" : "/spielen?art=musik")}>
          Neue Musikrunde
        </button>
      )}
    </Page>
  );
}

/** Solo: gleich noch eine Musikrunde im selben Modus */
function MusicAgainButton({ hard }: { hard: boolean }) {
  const [busy, setBusy] = useState(false);
  async function again() {
    unlockAudio();
    setBusy(true);
    try {
      const id = await rpc<number>("create_music_game", { p_mode: "solo", p_invitees: [], p_hard: hard });
      navigate(`/musik/${id}`);
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <button className="btn btn-primary btn-block btn-big again-btn" onClick={again} disabled={busy}>
      {busy ? "Songs werden gemischt …" : "Noch eins, los!"}
    </button>
  );
}
