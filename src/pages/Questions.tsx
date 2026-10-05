import { useAuth } from "../lib/auth";
import { useCategories, useLoad } from "../lib/hooks";
import { navigate } from "../lib/router";
import { rpc, supabase } from "../lib/supabase";
import type { Question, QuestionStats } from "../lib/types";
import { Empty, ErrorBox, Loading, Page } from "../components/ui";

type Count = { category_id: number; name: string; icon: string; total: number; mine: number };

export function QuestionsPage() {
  const { profile } = useAuth();
  const categories = useCategories();
  const counts = useLoad(() => rpc<Count[]>("question_counts"));
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

  return (
    <Page title="Fragen">
      <button className="btn btn-primary btn-block" onClick={() => navigate("/fragen/neu")}>
        Neue Frage schreiben
      </button>

      <section className="section">
        <h2>Fragenpool</h2>
        <p className="muted">
          {total} Fragen insgesamt.
          {thin.length > 0 && ` Hier fehlen noch welche: ${thin.map((c) => `${c.icon} ${c.name} (${c.total})`).join(", ")}.`}
        </p>
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
    </Page>
  );
}
