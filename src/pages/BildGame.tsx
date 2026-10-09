import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/hooks";
import { bildModeLabel, faceUrl, seconds } from "../lib/format";
import { navigate } from "../lib/router";
import { rpc } from "../lib/supabase";
import type { BildGameDetails, CurrentFace, FaceInfo, FaceResult, NamePick } from "../lib/types";
import { Icon } from "../components/Icon";
import { NameAnswer } from "../components/NameAnswer";
import { ErrorBox, Loading, Page, toast } from "../components/ui";

const LETTERS = ["A", "B", "C", "D"];

function pageTitle(game: { mode: keyof typeof bildModeLabel; hard?: boolean }) {
  return bildModeLabel[game.mode] + (game.hard ? " · Hard" : "");
}

export function BildGamePage({ id }: { id: number }) {
  const details = useLoad(() => rpc<BildGameDetails>("bild_game_details", { p_game_id: id }), [id]);
  const [playing, setPlaying] = useState(false);
  const { reload } = details;
  const finished = useCallback(() => {
    setPlaying(false);
    reload();
  }, [reload]);

  useEffect(() => {
    if (details.data?.can_play && details.data.started) setPlaying(true);
  }, [details.data]);

  if (details.loading && !details.data) return <Loading />;
  if (details.error || !details.data)
    return (
      <Page title="Bilder" back={() => navigate("/")}>
        <ErrorBox error={details.error ?? "Spiel nicht gefunden."} retry={details.reload} />
      </Page>
    );

  const g = details.data;
  if (playing && g.can_play) return <BildPlayer game={g} onFinished={finished} />;
  if (g.can_play) return <BildIntro game={g} onStart={() => setPlaying(true)} />;
  return <BildResult game={g} reload={details.reload} />;
}

function BildIntro({ game, onStart }: { game: BildGameDetails; onStart: () => void }) {
  const { profile } = useAuth();
  const others = game.players.filter((p) => p.user_id !== profile!.id);
  const creator = game.players.find((p) => p.user_id === game.created_by);
  return (
    <Page title={pageTitle(game)} back={() => navigate(game.mode === "league" ? "/liga" : "/")}>
      <div className="intro">
        <div className="portrait-stack" aria-hidden="true">
          <span />
          <span />
          <span>
            <Icon name="face" size={44} />
          </span>
        </div>
        {game.mode === "duel" && (
          <p className="lead">
            {game.created_by === profile!.id
              ? `Du forderst ${others[0]?.display_name} heraus. Du rätst zuerst, dann bekommt ${others[0]?.display_name} dieselben Gesichter.`
              : `${creator?.display_name} hat die Gesichter schon gesehen. Jetzt bist du dran.`}
          </p>
        )}
        {game.mode === "challenge" && (
          <p className="lead">Bilder-Challenge von {creator?.display_name} mit {game.players.length} Leuten. Alle sehen dieselben Gesichter.</p>
        )}
        {game.mode === "solo" && <p className="lead">5 Gesichter zum Üben, quer durch alle Jahrzehnte seit 1970.</p>}
        {game.mode === "league" && <p className="lead">Weekend League: Alle Angemeldeten sehen dieselben Gesichter.</p>}
        {game.hard ? (
          <ul className="rules">
            <li>Hard-Mode: keine Namen zur Auswahl</li>
            <li>Namen tippen und aus der Liste wählen, Spitznamen zählen auch</li>
            <li>30 Sekunden pro Gesicht, je ein Punkt</li>
          </ul>
        ) : (
          <ul className="rules">
            <li>5 Gesichter, je 15 Sekunden</li>
            <li>Vier Namen zur Auswahl, ein Punkt pro Treffer</li>
            <li>Bei gleicher Punktzahl gewinnt, wer schneller war</li>
          </ul>
        )}
        <button className="btn btn-primary btn-block btn-big" onClick={onStart}>
          Los geht's
        </button>
      </div>
    </Page>
  );
}

function Portrait({
  image,
  year,
  size = "big",
}: {
  image: string;
  year: number | null;
  size?: "big" | "compact" | "small";
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={`portrait${size === "big" ? "" : " is-" + size}${loaded ? " is-loaded" : ""}`}>
      <img src={faceUrl(image)} alt="Porträt" onLoad={() => setLoaded(true)} decoding="async" />
      {year && <span className="portrait-year">Foto von {year}</span>}
    </div>
  );
}

export function PhotoCredit({ info }: { info: FaceInfo }) {
  return (
    <p className="photo-credit">
      Foto: {info.artist || "unbekannt"}
      {info.license && <> · {info.license}</>} ·{" "}
      {info.source_url ? (
        <a href={info.source_url} target="_blank" rel="noreferrer">
          Wikimedia Commons
        </a>
      ) : (
        "Wikimedia Commons"
      )}
      {info.wiki_title && (
        <>
          {" · "}
          <a href={`https://de.wikipedia.org/wiki/${encodeURIComponent(info.wiki_title.replace(/ /g, "_"))}`} target="_blank" rel="noreferrer">
            Wikipedia
          </a>
        </>
      )}
    </p>
  );
}

function BildPlayer({ game, onFinished }: { game: BildGameDetails; onFinished: () => void }) {
  const [face, setFace] = useState<CurrentFace | null>(null);
  const [result, setResult] = useState<FaceResult | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [pick, setPick] = useState<NamePick | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(15);
  const endAt = useRef(0);
  const submitting = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    setFace(null);
    setResult(null);
    setChoice(null);
    setPick(null);
    submitting.current = false;
    try {
      const next = await rpc<CurrentFace | { done: true }>("bild_next", { p_game_id: game.id });
      if (next.done) {
        onFinished();
        return;
      }
      setFace(next);
      endAt.current = Date.now() + next.seconds_left * 1000;
      setRemaining(next.seconds_left);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [game.id, onFinished]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = useCallback(
    async (c: number | null, guess: NamePick | null) => {
      if (!face || submitting.current) return;
      submitting.current = true;
      try {
        const r = face.hard
          ? await rpc<FaceResult>("bild_answer_hard", { p_game_id: game.id, p_position: face.position, p_guess: guess?.name ?? null })
          : await rpc<FaceResult>("bild_answer", { p_game_id: game.id, p_position: face.position, p_choice: c });
        setResult(r);
        if (navigator.vibrate) navigator.vibrate(r.ok ? 30 : [60, 40, 60]);
      } catch (e) {
        setError((e as Error).message);
        submitting.current = false;
      }
    },
    [face, game.id],
  );

  // Countdown
  const current = useRef({ choice, pick });
  current.current = { choice, pick };
  useEffect(() => {
    if (!face || result) return;
    const t = setInterval(() => {
      const left = Math.max(0, (endAt.current - Date.now()) / 1000);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(t);
        submit(current.current.choice, current.current.pick);
      }
    }, 100);
    return () => clearInterval(t);
  }, [face, result, submit]);

  if (error)
    return (
      <Page title={pageTitle(game)} back={() => navigate(game.mode === "league" ? "/liga" : "/")}>
        <ErrorBox error={error} retry={load} />
      </Page>
    );
  if (!face) return <Loading text="Gesicht wird gesucht …" />;

  const total = face.seconds ?? 15;
  const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
  const urgent = remaining <= 5 && !result;

  function choose(i: number) {
    if (result || submitting.current) return;
    setChoice(i);
    submit(i, null);
  }

  return (
    <main className={result ? "play bild-play has-next" : "play bild-play"}>
      <div className="play-top">
        <button className="icon-btn" aria-label="Zurück zum Start" onClick={() => navigate(game.mode === "league" ? "/liga" : "/")}>
          <Icon name="back" />
        </button>
        <div className="play-progress" aria-label={`Gesicht ${face.position} von 5`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={n < face.position ? "dot done" : n === face.position ? "dot now" : "dot"} />
          ))}
        </div>
        <span className={urgent ? "play-seconds urgent" : "play-seconds"} aria-live="off">
          {result ? "" : Math.ceil(remaining)}
        </span>
      </div>
      <div className="timer" aria-hidden="true">
        <div className={urgent ? "timer-fill urgent" : "timer-fill"} style={{ width: `${result ? 0 : pct}%` }} />
      </div>

      <Portrait
        key={face.position}
        image={face.image}
        year={face.photo_year}
        size={result ? (face.hard ? "compact" : "small") : face.hard ? "compact" : "big"}
      />

      {face.hard && !result && (
        <NameAnswer pick={pick} onPick={setPick} onSubmit={() => submit(null, pick)} onSkip={() => submit(null, null)} />
      )}

      {!face.hard && (
        <section aria-label="Wer ist das?">
          {!result && <h1 className="play-question">Wer ist das?</h1>}
          <div className="answers">
            {face.options.map((opt, i) => {
              let cls = "answer";
              if (result) {
                if (i === result.correct) cls += " correct";
                else if (i === choice) cls += " wrong";
              }
              if (i === choice) cls += " picked";
              return (
                <button key={i} className={cls} disabled={!!result || choice !== null} onClick={() => choose(i)}>
                  <span className="answer-letter" aria-hidden="true">
                    {LETTERS[i]}
                  </span>
                  <span>{opt}</span>
                </button>
              );
            })}
          </div>
          {!result && (
            <div className="play-tools">
              <button className="link-btn" onClick={() => submit(null, null)} disabled={choice !== null}>
                Weiß ich nicht
              </button>
            </div>
          )}
        </section>
      )}

      {result && (
        <section className={result.ok ? "reveal reveal-hit" : "reveal reveal-miss"} aria-live="polite">
          <h2>{result.ok ? "Volltreffer!" : result.timed_out ? "Zeit abgelaufen" : "Daneben"}</h2>
          <p className="person-reveal">
            <strong>{result.name}</strong>
            {result.description && <span>{result.description}</span>}
          </p>
          {result.ok ? (
            <p className="muted small">+1 Punkt · in {seconds(result.ms)} erkannt</p>
          ) : (
            face.hard &&
            pick && <p className="muted small">Dein Tipp: {pick.name}</p>
          )}
          <PhotoCredit info={result} />
        </section>
      )}
      {result && (
        <div className="play-next">
          <button className="btn btn-primary btn-block btn-big" onClick={() => (result.finished ? onFinished() : load())}>
            {result.finished ? "Zum Ergebnis" : "Nächstes Gesicht"}
          </button>
        </div>
      )}
    </main>
  );
}

function BildResult({ game, reload }: { game: BildGameDetails; reload: () => void }) {
  const { profile } = useAuth();
  const me = profile!.id;
  const [busy, setBusy] = useState(false);
  const mine = game.players.find((p) => p.user_id === me)!;
  const done = game.players.filter((p) => p.status === "done");
  const pending = game.players.filter((p) => p.status === "pending");
  const revealed = game.items.length > 0;
  const other = game.mode === "duel" ? game.players.find((p) => p.user_id !== me) : undefined;

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
    if (game.status === "open") headline = other?.status === "pending" ? `Warten auf ${other.display_name}` : "Du bist dran";
    else if (mine.rank === 1 && other?.rank === 1) headline = "Unentschieden";
    else if (mine.rank === 1) headline = mine.score === other?.score ? "Gewonnen, nach Zeit!" : "Gewonnen!";
    else headline = mine.score === other?.score ? "Verloren, nach Zeit" : "Verloren";
  } else if (game.mode === "challenge") {
    headline = game.status === "open" ? `${done.length} von ${game.players.length} haben geraten` : `Platz ${mine.rank ?? "–"}`;
  } else {
    headline = `${mine.score ?? 0} von 5 erkannt`;
  }

  const stripPlayers = game.mode === "duel" && other && other.status === "done" ? [me, other.user_id] : [me];

  return (
    <Page title={pageTitle(game)} back={() => navigate(game.mode === "league" ? "/liga" : "/")}>
      <h2 className="result-headline">{headline}</h2>
      {game.mode !== "solo" && game.status !== "open" && game.my_points && (
        <p className={game.my_points.counted ? "points-note" : "points-note is-off"}>
          {game.my_points.counted
            ? `+${game.my_points.points} ${game.my_points.points === 1 ? "Punkt" : "Punkte"} für die Bilder-Rangliste · Wertungsspiel ${game.my_points.day_index} von 3 heute`
            : game.my_points.day_index
              ? `Keine Punkte: Dieses Spiel war dein ${game.my_points.day_index}. Bilderspiel an diesem Tag, es zählen nur die ersten 3.`
              : "Keine Punkte: Es hat nur eine Person gespielt."}
        </p>
      )}

      {game.mode === "duel" ? (
        <div className="duel-board">
          {[mine, ...game.players.filter((p) => p.user_id !== me)].map((p) => (
            <div key={p.user_id} className="duel-side">
              <p className="duel-name">{p.user_id === me ? "Du" : p.display_name}</p>
              <p className="duel-score">
                {p.score ?? "–"}
                <span className="duel-of">/5</span>
              </p>
              <p className="muted small">{p.status === "done" ? seconds(p.total_ms) : "rät noch"}</p>
            </div>
          ))}
        </div>
      ) : game.mode === "challenge" ? (
        <ol className="ranking">
          {done.map((p) => (
            <li key={p.user_id} className={p.user_id === me ? "me" : ""}>
              <span className="rank">{p.rank}.</span>
              <span className="ranking-name">{p.user_id === me ? "Du" : p.display_name}</span>
              <span className="ranking-score">
                {p.score} <span className="muted small">· {seconds(p.total_ms)}</span>
              </span>
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.user_id} className="pending">
              <span className="rank">–</span>
              <span className="ranking-name">{p.display_name}</span>
              <span className="muted small">{game.status === "open" ? "rät noch" : "nicht gespielt"}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {revealed && (
        <>
          <div className="face-strip">
            {game.items.map((it) => (
              <div key={it.position} className="face-cell">
                <img src={faceUrl(it.image)} alt={it.name} loading="lazy" />
                <span className="face-marks">
                  {stripPlayers.map((u) => (
                    <i key={u} className={it.answers[u]?.ok ? "good" : "bad"} />
                  ))}
                </span>
              </div>
            ))}
          </div>
          {stripPlayers.length === 2 && (
            <p className="muted small face-legend">
              <span>links: du</span>
              <span>rechts: {other?.display_name}</span>
            </p>
          )}
        </>
      )}

      {game.mode === "solo" && (
        <div className="solo-board">
          <BildAgainButton hard={!!game.hard} />
        </div>
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
          <h2>Die Gesichter</h2>
          <ul className="person-list">
            {game.items.map((it) => {
              const others = game.players.filter((p) => p.user_id !== me && it.answers[p.user_id]);
              const my = it.answers[me];
              const myText = my && !my.ok ? (my.choice !== null ? it.options[my.choice] : my.guess) : null;
              return (
                <li key={it.position} className="person-row">
                  <img src={faceUrl(it.image)} alt="" loading="lazy" />
                  <div>
                    <p className="person-name">{it.name}</p>
                    {it.description && <p className="person-desc small muted">{it.description}</p>}
                    <p className="song-marks small">
                      {my && (
                        <span className={my.ok ? "good" : "bad"}>
                          {my.ok ? "✓" : "✗"} Du{myText ? `: ${myText}` : ""}
                        </span>
                      )}
                      {others.map((p) => (
                        <span key={p.user_id} className={it.answers[p.user_id].ok ? "good" : "bad"}>
                          {it.answers[p.user_id].ok ? "✓" : "✗"} {p.display_name}
                        </span>
                      ))}
                    </p>
                    <PhotoCredit info={it} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {game.mode === "league" ? (
        <button className="btn btn-primary btn-block" onClick={() => navigate("/liga")}>
          Zur Weekend League
        </button>
      ) : (
        game.mode !== "solo" &&
        game.status !== "open" && (
          <button className="btn btn-primary btn-block" onClick={() => navigate(game.hard ? "/spielen?art=bilder&hard=1" : "/spielen?art=bilder")}>
            Neue Bilderrunde
          </button>
        )
      )}
    </Page>
  );
}

/** Solo: gleich noch eine Bilderrunde im selben Modus */
function BildAgainButton({ hard }: { hard: boolean }) {
  const [busy, setBusy] = useState(false);
  async function again() {
    setBusy(true);
    try {
      const id = await rpc<number>("create_bild_game", { p_mode: "solo", p_invitees: [], p_hard: hard });
      navigate(`/bilder/${id}`);
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <button className="btn btn-primary btn-block btn-big again-btn" onClick={again} disabled={busy}>
      {busy ? "Gesichter werden gemischt …" : "Noch eins, los!"}
    </button>
  );
}
