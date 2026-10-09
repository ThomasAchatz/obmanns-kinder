import { useEffect, useRef, useState } from "react";
import { rpc } from "../lib/supabase";
import type { NamePick } from "../lib/types";
import { Icon } from "./Icon";

// Hard-Mode der Bilderrunde: Namen tippen und aus der Vorschlagsliste wählen.
export function NameAnswer({
  pick,
  onPick,
  onSubmit,
  onSkip,
}: {
  pick: NamePick | null;
  onPick: (p: NamePick | null) => void;
  onSubmit: () => void;
  onSkip: () => void;
}) {
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<NamePick[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef("");

  useEffect(() => {
    const q = term.trim();
    latest.current = q;
    if (q.length < 3) {
      setHits(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await rpc<NamePick[]>("bild_search", { p_query: q });
        if (latest.current === q) setHits(r);
      } catch {
        if (latest.current === q) setHits([]);
      }
    }, 160);
    return () => clearTimeout(t);
  }, [term]);

  if (pick) {
    return (
      <section className="hard" aria-label="Deine Antwort">
        <h1 className="play-question">Dein Tipp</h1>
        <div className="hard-pick">
          <Icon name="face" />
          <span>
            <strong>{pick.name}</strong>
            {pick.sub && <span className="muted">{pick.sub}</span>}
          </span>
          <button
            className="link-btn"
            onClick={() => {
              onPick(null);
              setTimeout(() => input.current?.focus(), 0);
            }}
          >
            ändern
          </button>
        </div>
        <button className="btn btn-primary btn-block btn-big" onClick={onSubmit}>
          Antwort abgeben
        </button>
      </section>
    );
  }

  return (
    <section className="hard" aria-label="Wer ist das?">
      <h1 className="play-question">Wer ist das?</h1>
      <label className="search-field hard-input">
        <Icon name="search" size={18} />
        <input
          ref={input}
          type="search"
          placeholder="Namen tippen …"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
        />
      </label>
      {term.trim().length > 0 && term.trim().length < 3 && <p className="hard-hint">Noch {3 - term.trim().length} Buchstaben …</p>}
      {hits && hits.length === 0 && <p className="hard-hint">Niemand gefunden. Anders schreiben, oder nur den Nachnamen?</p>}
      {hits && hits.length > 0 && (
        <ul className="hard-hits" role="listbox">
          {hits.map((h) => (
            <li key={h.name + "|" + (h.sub ?? "")}>
              <button role="option" aria-selected={false} onClick={() => onPick(h)}>
                <strong>{h.name}</strong>
                {h.sub && <span>{h.sub}</span>}
              </button>
            </li>
          ))}
          {hits.length === 8 && <li className="hard-hint">Mehr Treffer? Weiter tippen.</li>}
        </ul>
      )}
      <div className="play-tools">
        <button className="link-btn" onClick={onSkip}>
          Weiß ich nicht
        </button>
      </div>
    </section>
  );
}
