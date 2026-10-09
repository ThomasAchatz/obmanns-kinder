import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/hooks";
import { modeLabel, seconds } from "../lib/format";
import { navigate } from "../lib/router";
import { rpc, supabase } from "../lib/supabase";
import type { AnswerResult, CurrentQuestion, GameDetails } from "../lib/types";
import { Icon } from "../components/Icon";
import { QuestionFeedback } from "../components/QuestionFeedback";
import { Target, type Shot } from "../components/Target";
import { ErrorBox, Loading, Page, StoredImage, toast } from "../components/ui";

const LETTERS = ["A", "B", "C", "D"];

export function GamePage({ id }: { id: number }) {
  const details = useLoad(() => rpc<GameDetails>("game_details", { p_game_id: id }), [id]);
  const [playing, setPlaying] = useState(false);
  const { reload } = details;
  const finished = useCallback(() => {
    setPlaying(false);
    reload();
  }, [reload]);

  // Wer mitten in einem Spiel neu lädt, landet direkt wieder in der Frage
  useEffect(() => {
    if (details.data?.can_play && details.data.started) setPlaying(true);
  }, [details.data]);

  if (details.loading && !details.data) return <Loading />;
  if (details.error || !details.data)
    return (
      <Page title="Spiel" back={() => navigate("/")}>
        <ErrorBox error={details.error ?? "Spiel nicht gefunden."} retry={details.reload} />
      </Page>
    );

  const g = details.data;

  if (playing && g.can_play) {
    return <Player game={g} onFinished={finished} />;
  }

  if (g.can_play) return <Intro game={g} onStart={() => setPlaying(true)} />;

  return <Result game={g} reload={details.reload} />;
}

function Intro({ game, onStart }: { game: GameDetails; onStart: () => void }) {
  const { profile } = useAuth();
  const others = game.players.filter((p) => p.user_id !== profile!.id);
  const creator = game.players.find((p) => p.user_id === game.created_by);
  return (
    <Page title={modeLabel[game.mode]} back={() => navigate(game.mode === "league" ? "/liga" : "/")}>
      <div className="intro">
        <Target shots={[]} size={160} label="Leere Scheibe" />
        {game.mode === "duel" && (
          <p className="lead">
            {game.created_by === profile!.id
              ? `Du forderst ${others[0]?.display_name} heraus. Du spielst zuerst, dann bekommt ${others[0]?.display_name} dieselben Fragen.`
              : `${creator?.display_name} hat die Fragen schon gespielt. Jetzt bist du dran.`}
          </p>
        )}
        {game.mode === "challenge" && (
          <p className="lead">
            Gruppen-Challenge von {creator?.display_name} mit {game.players.length} Leuten. Alle bekommen dieselben Fragen.
          </p>
        )}
        {game.mode === "league" && (
          <p className="lead">Weekend League: Alle Angemeldeten bekommen dieselben Fragen. Spiel, wann du willst, bis Sonntag 23:59.</p>
        )}
        {game.mode === "solo" && (
          <p className="lead">
            {game.category ? `${game.category.icon} ${game.category.name}: 5 Fragen zum Üben.` : "5 gemischte Fragen zum Üben."}
          </p>
        )}
        <ul className="rules">
          <li>5 Fragen, je 30 Sekunden</li>
          <li>Ein 50:50-Joker für das ganze Spiel. Bei Gleichstand gewinnt, wer ihn nicht genommen hat.</li>
          <li>Wer die App während einer Frage verlässt, verliert die Zeit dieser Frage</li>
        </ul>
        <button className="btn btn-primary btn-block btn-big" onClick={onStart}>
          Los geht's
        </button>
      </div>
    </Page>
  );
}

function Player({ game, onFinished }: { game: GameDetails; onFinished: () => void }) {
  const [q, setQ] = useState<CurrentQuestion | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [hidden, setHidden] = useState<number[]>([]);
  const [jokerLeft, setJokerLeft] = useState(!game.joker_used);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(30);
  const [picked, setPicked] = useState<number | null>(null);
  const endAt = useRef(0);
  const submitting = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    setQ(null); // alte Frage sofort weg, damit sie nicht nochmal angetippt werden kann
    setResult(null);
    setPicked(null);
    submitting.current = false;
    try {
      const next = await rpc<CurrentQuestion | { done: true }>("next_question", { p_game_id: game.id });
      if (next.done) {
        onFinished();
        return;
      }
      setQ(next);
      setHidden(next.hidden ?? []);
      setJokerLeft(next.joker_available);
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
    async (choice: number | null) => {
      if (!q || submitting.current) return;
      submitting.current = true;
      setPicked(choice);
      try {
        const r = await rpc<AnswerResult>("submit_answer", { p_game_id: game.id, p_position: q.position, p_choice: choice });
        setResult(r);
        if (navigator.vibrate) navigator.vibrate(r.is_correct ? 30 : [60, 40, 60]);
      } catch (e) {
        setError((e as Error).message);
        submitting.current = false;
      }
    },
    [q, game.id],
  );

  // Countdown
  useEffect(() => {
    if (!q || result) return;
    const t = setInterval(() => {
      const left = Math.max(0, (endAt.current - Date.now()) / 1000);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(t);
        submit(null);
      }
    }, 100);
    return () => clearInterval(t);
  }, [q, result, submit]);

  async function joker() {
    if (!q) return;
    try {
      const h = await rpc<number[]>("use_joker", { p_game_id: game.id, p_position: q.position });
      setHidden(h);
      setJokerLeft(false);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  if (error)
    return (
      <Page title={modeLabel[game.mode]} back={() => navigate(game.mode === "league" ? "/liga" : "/")}>
        <ErrorBox error={error} retry={load} />
      </Page>
    );
  if (!q) return <Loading text="Frage wird geladen …" />;

  const pct = Math.max(0, Math.min(100, (remaining / 30) * 100));
  const urgent = remaining <= 8 && !result;

  return (
    <main className={result ? "play has-next" : "play"}>
      <div className="play-top">
        <button className="icon-btn" aria-label="Zurück" onClick={() => navigate(game.mode === "league" ? "/liga" : "/")}>
          <Icon name="back" />
        </button>
        <div className="play-progress" aria-label={`Frage ${q.position} von 5`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={n < q.position ? "dot done" : n === q.position ? "dot now" : "dot"} />
          ))}
        </div>
        <span className={urgent ? "play-seconds urgent" : "play-seconds"} aria-live="off">
          {result ? "" : Math.ceil(remaining)}
        </span>
      </div>
      <div className="timer" aria-hidden="true">
        <div className={urgent ? "timer-fill urgent" : "timer-fill"} style={{ width: `${result ? 0 : pct}%` }} />
      </div>

      <p className="play-category">
        {q.category.icon} {q.category.name}
      </p>
      <h1 className="play-question">{q.text}</h1>
      <StoredImage bucket="question-images" path={q.image_path} alt="Bild zur Frage" />

      <div className="answers">
        {q.options.map((opt, i) => {
          const isHidden = hidden.includes(i);
          let cls = "answer";
          if (result) {
            if (i === result.correct_index) cls += " correct";
            else if (i === picked) cls += " wrong";
            else cls += " faded";
          } else if (picked === i) cls += " picked";
          if (isHidden) cls += " hidden";
          return (
            <button key={i} className={cls} disabled={!!result || isHidden || picked !== null} onClick={() => submit(i)}>
              <span className="answer-letter" aria-hidden="true">
                {LETTERS[i]}
              </span>
              <span>{isHidden ? "–" : opt}</span>
            </button>
          );
        })}
      </div>

      {!result && (
        <div className="play-tools">
          <button className="btn btn-ghost btn-joker" onClick={joker} disabled={!jokerLeft || picked !== null}>
            50:50 {jokerLeft ? "" : "(verbraucht)"}
          </button>
        </div>
      )}

      {result && (
        <section className={result.is_correct ? "reveal reveal-hit" : "reveal reveal-miss"} aria-live="polite">
          <h2>{result.is_correct ? "Treffer!" : result.timed_out ? "Zeit abgelaufen" : "Daneben"}</h2>
          {!result.is_correct && (
            <p>
              Richtig war: <strong>{q.options[result.correct_index]}</strong>
            </p>
          )}
          {result.explanation && <p className="reveal-explain">{result.explanation}</p>}
          {result.source_url && (
            <p className="small">
              <a href={result.source_url} target="_blank" rel="noreferrer">
                Quelle ansehen
              </a>
            </p>
          )}
          <p className="muted small">
            Frage von {result.author}
            {q.substitute && " · Ersatzfrage, weil die Originalfrage von dir ist"}
          </p>
          <QuestionFeedback questionId={result.question_id} initialVote={result.my_vote} />
        </section>
      )}
      {result && (
        <div className="play-next">
          <button className="btn btn-primary btn-block btn-big" onClick={() => (result.finished ? onFinished() : load())}>
            {result.finished ? "Zum Ergebnis" : "Nächste Frage"}
          </button>
        </div>
      )}
    </main>
  );
}

function shotsFor(game: GameDetails, userId: string): Shot[] {
  return game.questions.map((q) => {
    const a = q.answers[userId];
    return { position: q.position, correct: a?.is_correct ?? null, ms: a?.ms ?? null, answered: !!a };
  });
}

function Result({ game, reload }: { game: GameDetails; reload: () => void }) {
  const { profile } = useAuth();
  const me = profile!.id;
  const [busy, setBusy] = useState(false);
  const mine = game.players.find((p) => p.user_id === me)!;
  const done = game.players.filter((p) => p.status === "done");
  const pending = game.players.filter((p) => p.status === "pending");
  const revealed = game.questions.length > 0;

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
    else if (mine.rank === 1)
      headline =
        mine.score !== other?.score ? "Gewonnen!" : !!mine.joker_used !== !!other?.joker_used ? "Gewonnen, ohne 50:50!" : "Gewonnen, nach Zeit!";
    else
      headline =
        mine.score !== other?.score ? "Verloren" : !!mine.joker_used !== !!other?.joker_used ? "Verloren wegen 50:50" : "Verloren, nach Zeit";
  } else if (game.mode === "challenge") {
    headline = game.status === "open" ? `${done.length} von ${game.players.length} haben gespielt` : `Platz ${mine.rank ?? "–"}`;
  } else {
    headline = `${mine.score ?? 0} von 5 richtig`;
  }

  return (
    <Page title={modeLabel[game.mode]} back={() => navigate(game.mode === "league" ? "/liga" : "/")}>
      <h2 className="result-headline">{headline}</h2>
      {game.mode !== "solo" && game.status !== "open" && game.my_points && (
        <p className={game.my_points.counted ? "points-note" : "points-note is-off"}>
          {game.my_points.counted
            ? `+${game.my_points.points} ${game.my_points.points === 1 ? "Punkt" : "Punkte"} · Wertungsspiel ${game.my_points.day_index} von 3 heute`
            : game.my_points.day_index
              ? `Keine Punkte: Dieses Spiel war dein ${game.my_points.day_index}. an diesem Tag, es zählen nur die ersten 3.`
              : "Keine Punkte: Es hat nur eine Person gespielt."}
        </p>
      )}

      {game.mode === "duel" ? (
        <div className="duel-board">
          {[mine, ...game.players.filter((p) => p.user_id !== me)].map((p) => (
            <div key={p.user_id} className="duel-side">
              <Target shots={revealed ? shotsFor(game, p.user_id) : []} size={140} dim={p.status !== "done"} />
              <p className="duel-name">{p.user_id === me ? "Du" : p.display_name}</p>
              <p className="duel-score">{p.score ?? "–"}</p>
              <p className="muted small">{p.status === "done" ? seconds(p.total_ms) : "spielt noch"}</p>
            </div>
          ))}
        </div>
      ) : game.mode === "solo" ? (
        <div className="solo-board">
          <Target shots={shotsFor(game, me)} size={180} />
          <p className="muted small">Je näher an der Mitte, desto schneller warst du.</p>
          <AgainButton gameId={game.id} />
        </div>
      ) : (
        <ol className="ranking">
          {done.map((p) => (
            <li key={p.user_id} className={p.user_id === me ? "me" : ""}>
              <span className="rank">{p.rank}.</span>
              <Target shots={revealed ? shotsFor(game, p.user_id) : []} size={44} />
              <span className="ranking-name">{p.user_id === me ? "Du" : p.display_name}</span>
              <span className="ranking-score">
                {p.score} <span className="muted small">· {seconds(p.total_ms)}</span>
              </span>
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.user_id} className="pending">
              <span className="rank">–</span>
              <Target shots={[]} size={44} dim />
              <span className="ranking-name">{p.display_name}</span>
              <span className="muted small">{game.status === "open" ? "spielt noch" : "nicht gespielt"}</span>
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
          <h2>Die Fragen</h2>
          <div className="stack">
            {game.questions.map((q) => (
              <ReviewCard key={q.position} q={q} game={game} me={me} />
            ))}
          </div>
        </section>
      )}

      {game.mode === "league" ? (
        <button className="btn btn-primary btn-block" onClick={() => navigate("/liga")}>
          Zur Weekend League
        </button>
      ) : (
        game.mode !== "solo" &&
        game.status !== "open" && (
          <button className="btn btn-primary btn-block" onClick={() => navigate("/spielen")}>
            Neues Spiel
          </button>
        )
      )}
    </Page>
  );
}

function ReviewCard({ q, game, me }: { q: GameDetails["questions"][number]; game: GameDetails; me: string }) {
  const my = q.answers[me];
  const others = game.players.filter((p) => p.user_id !== me && q.answers[p.user_id]);
  return (
    <article className="review">
      <p className="play-category">
        {q.position}. {q.category.icon} {q.category.name}
      </p>
      <h3>{q.text}</h3>
      <StoredImage bucket="question-images" path={q.image_path} alt="Bild zur Frage" />
      <ul className="review-options">
        {q.options.map((o, i) => (
          <li key={i} className={i === q.correct_index ? "correct" : my?.chosen === i ? "wrong" : ""}>
            <span className="answer-letter">{LETTERS[i]}</span> {o}
            {my?.chosen === i && <span className="tag">du</span>}
          </li>
        ))}
      </ul>
      {my && my.chosen === null && <p className="bad small">Du: Zeit abgelaufen</p>}
      {others.length > 0 && (
        <p className="small review-others">
          {others.map((p) => {
            const a = q.answers[p.user_id];
            return (
              <span key={p.user_id} className={a.is_correct ? "good" : "bad"}>
                {p.display_name} {a.is_correct ? "✓" : "✗"}
                {!a.is_correct && a.chosen_text ? ` (${a.chosen_text})` : ""}
                {a.chosen === null ? " (Zeit)" : ""}
              </span>
            );
          })}
        </p>
      )}
      {q.substitute && <p className="muted small">Ersatzfrage für dich, weil die Originalfrage von dir ist.</p>}
      {q.explanation && <p className="reveal-explain">{q.explanation}</p>}
      {q.source_url && (
        <p className="small">
          <a href={q.source_url} target="_blank" rel="noreferrer">
            Quelle ansehen
          </a>
        </p>
      )}
      <p className="muted small">Frage von {q.author}</p>
      <QuestionFeedback questionId={q.question_id} initialVote={q.my_vote} />
    </article>
  );
}

/** Solo: gleich noch eine Runde mit denselben Kategorien */
function AgainButton({ gameId }: { gameId: number }) {
  const [busy, setBusy] = useState(false);
  async function again() {
    setBusy(true);
    try {
      const { data } = await supabase.from("games").select("category_ids").eq("id", gameId).maybeSingle();
      const cats = (data as { category_ids: number[] | null } | null)?.category_ids ?? null;
      const id = await rpc<number>("create_game", { p_mode: "solo", p_category_ids: cats && cats.length ? cats : null });
      navigate(`/spiel/${id}`);
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <button className="btn btn-primary btn-block btn-big again-btn" onClick={again} disabled={busy}>
      {busy ? "Fragen werden gezogen …" : "Noch eins, los!"}
    </button>
  );
}
