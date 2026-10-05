import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/hooks";
import { deleteImage, uploadImage } from "../lib/images";
import { timeAgo } from "../lib/format";
import { errorText, supabase } from "../lib/supabase";
import type { Fact } from "../lib/types";
import { Icon } from "../components/Icon";
import { Empty, ErrorBox, ImagePicker, Loading, Page, StoredImage, toast } from "../components/ui";

const PAGE = 30;

export function FactsPage() {
  const { profile } = useAuth();
  const [limit, setLimit] = useState(PAGE);
  const facts = useLoad(async () => {
    const { data, error } = await supabase
      .from("facts")
      .select("id, author_id, text, image_path, created_at, author:profiles(display_name), fact_likes(user_id)")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data as unknown as Fact[];
  }, [limit]);

  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() && !file) return;
    setBusy(true);
    setError(null);
    try {
      const image_path = file ? await uploadImage("fact-images", profile!.id, file) : null;
      const { error } = await supabase.from("facts").insert({ author_id: profile!.id, text: text.trim() || null, image_path });
      if (error) throw error;
      setText("");
      setFile(null);
      facts.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleLike(f: Fact) {
    const liked = f.fact_likes.some((l) => l.user_id === profile!.id);
    // sofort anzeigen, dann speichern
    facts.setData((list) =>
      (list ?? []).map((x) =>
        x.id !== f.id
          ? x
          : { ...x, fact_likes: liked ? x.fact_likes.filter((l) => l.user_id !== profile!.id) : [...x.fact_likes, { user_id: profile!.id }] },
      ),
    );
    const { error } = liked
      ? await supabase.from("fact_likes").delete().eq("fact_id", f.id).eq("user_id", profile!.id)
      : await supabase.from("fact_likes").insert({ fact_id: f.id, user_id: profile!.id });
    if (error) {
      toast(errorText(error));
      facts.reload();
    }
  }

  async function remove(f: Fact) {
    if (!confirm("Diesen Beitrag löschen?")) return;
    const { error } = await supabase.from("facts").delete().eq("id", f.id);
    if (error) return toast(errorText(error));
    await deleteImage("fact-images", f.image_path);
    facts.reload();
  }

  return (
    <Page title="Unnützes Wissen">
      <form className="composer" onSubmit={post}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Wusstest du, dass …"
          aria-label="Neuer Beitrag"
        />
        <div className="composer-row">
          <ImagePicker file={file} onChange={setFile} />
          <button className="btn btn-primary" disabled={busy || (!text.trim() && !file)}>
            {busy ? "Posten …" : "Posten"}
          </button>
        </div>
        <ErrorBox error={error} />
      </form>

      <ErrorBox error={facts.error} retry={facts.reload} />
      {facts.loading && !facts.data ? (
        <Loading />
      ) : (facts.data ?? []).length === 0 ? (
        <Empty>
          <p>Noch nichts hier. Fang an mit dem unnützesten Fakt, den du kennst.</p>
        </Empty>
      ) : (
        <div className="feed">
          {facts.data!.map((f) => {
            const liked = f.fact_likes.some((l) => l.user_id === profile!.id);
            return (
              <article key={f.id} className="fact">
                {f.text && <p className="fact-text">{f.text}</p>}
                <StoredImage bucket="fact-images" path={f.image_path} alt="Bild zum Beitrag" />
                <footer className="fact-foot">
                  <span className="muted small">
                    {f.author?.display_name} · {timeAgo(f.created_at)}
                  </span>
                  <span className="fact-actions">
                    {(f.author_id === profile!.id || profile!.is_admin) && (
                      <button className="icon-btn" aria-label="Beitrag löschen" onClick={() => remove(f)}>
                        <Icon name="trash" size={18} />
                      </button>
                    )}
                    <button className={liked ? "like on" : "like"} aria-pressed={liked} onClick={() => toggleLike(f)}>
                      <Icon name="heart" size={18} filled={liked} />
                      <span>{f.fact_likes.length}</span>
                    </button>
                  </span>
                </footer>
              </article>
            );
          })}
          {facts.data!.length >= limit && (
            <button className="btn btn-ghost btn-block" onClick={() => setLimit((l) => l + PAGE)}>
              Ältere laden
            </button>
          )}
        </div>
      )}
    </Page>
  );
}
