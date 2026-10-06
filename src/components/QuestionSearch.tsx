import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { navigate } from "../lib/router";
import { rpc } from "../lib/supabase";
import type { CategoryRef } from "../lib/types";
import { Icon } from "./Icon";

type Hit = {
  id: number;
  text: string;
  correct: string;
  wrong_1: string;
  wrong_2: string;
  wrong_3: string;
  explanation: string | null;
  source_url: string | null;
  is_active: boolean;
  category: CategoryRef;
  author: string;
  mine: boolean;
  plays: number;
  correct_rate: number | null;
};
type Result = { scope: "all" | "seen"; total: number; results: Hit[] };

/** Suchbegriff im Text hervorheben */
function Marked({ text, term }: { text: string; term: string }): ReactNode {
  const t = term.trim();
  if (t.length < 2) return text;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  const needle = t.toLowerCase();
  let i = 0;
  let at = lower.indexOf(needle);
  while (at >= 0) {
    if (at > i) parts.push(text.slice(i, at));
    parts.push(<mark key={at}>{text.slice(at, at + t.length)}</mark>);
    i = at + t.length;
    at = lower.indexOf(needle, i);
  }
  parts.push(text.slice(i));
  return parts;
}

export function QuestionSearch({ term, onTerm }: { term: string; onTerm: (t: string) => void }) {
  const { profile } = useAuth();
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef("");

  useEffect(() => {
    const q = term.trim();
    latest.current = q;
    if (q.length < 2) {
      setRes(null);
      return;
    }
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await rpc<Result>("search_questions", { p_query: q });
        if (latest.current === q) setRes(r);
      } catch {
        if (latest.current === q) setRes({ scope: "seen", total: 0, results: [] });
      } finally {
        if (latest.current === q) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [term]);

  return (
    <div className="qsearch">
      <label className="search-field">
        <Icon name="search" size={18} />
        <input
          type="search"
          placeholder="Fragen und Antworten durchsuchen"
          value={term}
          onChange={(e) => onTerm(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
        />
      </label>
      {!profile!.is_admin && term.trim().length === 0 && (
        <p className="muted small qsearch-hint">Du findest Fragen, die du schon gespielt hast, und deine eigenen.</p>
      )}
      {term.trim().length >= 2 && (
        <div className="qsearch-results" aria-live="polite">
          {busy && !res ? (
            <p className="muted small">Sucht …</p>
          ) : res && res.total === 0 ? (
            <p className="muted">
              Keine Treffer für „{term.trim()}“.
              {res.scope === "seen" && " Gesucht wird in Fragen, die du schon gespielt hast, und in deinen eigenen."}
            </p>
          ) : res ? (
            <>
              <p className="muted small">
                {res.total} {res.total === 1 ? "Treffer" : "Treffer"}
                {res.total > res.results.length && `, die ersten ${res.results.length} angezeigt`}
                {res.scope === "seen" ? " · in deinen gespielten und eigenen Fragen" : " · alle Fragen"}
              </p>
              <div className="stack">
                {res.results.map((q) => (
                  <article key={q.id} className="review qsearch-card">
                    <p className="play-category">
                      {q.category.icon} {q.category.name}
                      {!q.is_active && <span className="pill">pausiert</span>}
                    </p>
                    <h3>
                      <Marked text={q.text} term={term} />
                    </h3>
                    <ul className="review-options">
                      <li className="correct">
                        <span className="answer-letter">✓</span> <Marked text={q.correct} term={term} />
                      </li>
                      {[q.wrong_1, q.wrong_2, q.wrong_3].map((w, i) => (
                        <li key={i}>
                          <span className="answer-letter">✗</span> <Marked text={w} term={term} />
                        </li>
                      ))}
                    </ul>
                    {q.explanation && (
                      <p className="reveal-explain">
                        <Marked text={q.explanation} term={term} />
                      </p>
                    )}
                    {q.source_url && (
                      <p className="small">
                        <a href={q.source_url} target="_blank" rel="noreferrer">
                          Quelle ansehen
                        </a>
                      </p>
                    )}
                    <p className="muted small qsearch-meta">
                      <span>
                        von {q.author}
                        {q.plays > 0 ? ` · ${q.plays}× gespielt · ${q.correct_rate ?? 0} % richtig` : " · noch nicht gespielt"}
                      </span>
                      {q.mine && (
                        <button className="link-btn" onClick={() => navigate(`/fragen/${q.id}`)}>
                          Bearbeiten
                        </button>
                      )}
                    </p>
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
