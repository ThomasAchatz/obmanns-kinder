import { useAuth } from "../lib/auth";
import { useCategories, useLoad } from "../lib/hooks";
import { navigate } from "../lib/router";
import { rpc, supabase } from "../lib/supabase";
import type { Question, QuestionStats, SongCounts } from "../lib/types";
import { Icon } from "../components/Icon";
import { QuestionSearch } from "../components/QuestionSearch";
import { useState } from "react";
import { Empty, ErrorBox, Loading, Page } from "../components/ui";

type Count = { category_id: number; name: string; icon: string; total: number; mine: number };

export function QuestionsPage() {
  const { profile } = useAuth();
  const categories = useCategories();
  const counts = useLoad(() => rpc<Count[]>("question_counts"));
  const songs = useLoad(() => rpc<SongCounts>("song_counts"));
  const [term, setTerm] = useState("");
  const searching = term.trim().length >= 2;
  const mine = useLoad(async () => {
    const [{ data, error }, stats] = await Promise.all([
      supabase
        .from("questions")
        .select("id, category_id, author_id, text, image_path, correct, wrong_1, wrong_2, wrong_3, explanation, source_url, is_active, created_at")
        .eq("author_id", profile!.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      rpc<QuestionStats[]>("my_question_stats"),
    ]);
    if (error) throw error;
    const byId = new Map(stats.map((s) => [s.question_id, s]));
    return (data as Question[]).map((q) => ({ ...q, stats: byId.get(q.id) }));
  });

  const catName = (id: number) => {
    const c = categories.data?.find((x) => x.id === id);
    return c ? `${c.icon} ${c.name}` : "";
  };
  const total = (counts.data ?? []).reduce((s, c) => s + c.total, 0);
  const thin = (counts.data ?? []).filter((c) => c.total < 10);
  const maxCount = Math.max(1, ...(counts.data ?? []).map((c) => c.total));

  return (
    <Page title="Fragen">
      <QuestionSearch term={term} onTerm={setTerm} />
      {!searching && (
        <>
      <button className="btn btn-primary btn-block" onClick={() => navigate("/fragen/neu")}>
        Neue Frage schreiben
      </button>

      <section className="section">
        <div className="section-head">
          <h2>Fragenpool</h2>
          <span className="muted small">{total} Fragen</span>
        </div>
        <ul className="meters">
          {(counts.data ?? []).map((c) => (
            <li key={c.category_id} className={c.total < 10 ? "is-low" : ""}>
              <span className="meter-label">
                <span className="meter-icon" aria-hidden="true">
                  {c.icon}
                </span>
                {c.name}
              </span>
              <span className="meter-value">
                {c.total}
                {c.mine > 0 && <span className="meter-sub"> · {c.mine} von dir</span>}
              </span>
              <span className="meter-track" aria-hidden="true">
                <span className="meter-fill" style={{ width: `${Math.min(100, (c.total / maxCount) * 100)}%` }} />
              </span>
            </li>
          ))}
        </ul>
        {thin.length > 0 && <p className="muted small">Kategorien mit weniger als 10 Fragen sind markiert. Dort freuen sich alle über Nachschub.</p>}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Songs für die Musikrunde</h2>
          {songs.data && <span className="muted small">{songs.data.total} Songs</span>}
        </div>
        <button className="song-teaser" onClick={() => navigate("/songs/neu")}>
          <Icon name="music" />
          <span>
            <strong>Song hinzufügen</strong>
            <span className="muted small">
              {songs.data?.mine ? `${songs.data.mine} von dir im Pool` : "Such ihn bei Apple Music, der Ausschnitt kommt von selbst."}
            </span>
          </span>
        </button>
      </section>

      <section className="section">
        <h2>Meine Fragen</h2>
        <ErrorBox error={mine.error} retry={mine.reload} />
        {mine.loading && !mine.data ? (
          <Loading />
        ) : (mine.data ?? []).length === 0 ? (
          <Empty>
            <p>Du hast noch keine Fragen geschrieben. Deine Fragen bekommen alle anderen gestellt, nur du nie.</p>
          </Empty>
        ) : (
          <div className="stack">
            {mine.data!.map((q) => (
              <button key={q.id} className="question-row" onClick={() => navigate(`/fragen/${q.id}`)}>
                <span className="play-category">{catName(q.category_id)}</span>
                <span className="question-row-text">{q.text}</span>
                <span className="muted small">
                  {q.stats?.plays ? `${q.stats.plays}× gespielt · ${q.stats.correct_rate ?? 0} % richtig` : "Noch nicht gespielt"}
                  {q.stats && (q.stats.upvotes > 0 || q.stats.downvotes > 0) && ` · 👍 ${q.stats.upvotes} 👎 ${q.stats.downvotes}`}
                </span>
                {(q.stats?.open_reports ?? 0) > 0 && <span className="pill pill-red">{q.stats!.open_reports} Meldung</span>}
                {!q.is_active && <span className="pill">pausiert</span>}
              </button>
            ))}
          </div>
        )}
      </section>
        </>
      )}
    </Page>
  );
}
