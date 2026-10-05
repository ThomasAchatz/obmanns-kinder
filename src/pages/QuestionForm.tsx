import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { useCategories } from "../lib/hooks";
import { deleteImage, uploadImage, useImageUrl } from "../lib/images";
import { navigate } from "../lib/router";
import { errorText, rpc, supabase } from "../lib/supabase";
import type { Question } from "../lib/types";
import { ErrorBox, ImagePicker, Loading, Page, toast } from "../components/ui";

type Form = {
  category_id: string;
  text: string;
  correct: string;
  wrong_1: string;
  wrong_2: string;
  wrong_3: string;
  explanation: string;
  source_url: string;
  is_active: boolean;
  image_path: string | null;
};

const empty: Form = {
  category_id: "",
  text: "",
  correct: "",
  wrong_1: "",
  wrong_2: "",
  wrong_3: "",
  explanation: "",
  source_url: "",
  is_active: true,
  image_path: null,
};

export function QuestionFormPage({ id }: { id?: number }) {
  const { profile } = useAuth();
  const categories = useCategories();
  const [form, setForm] = useState<Form>(empty);
  const [loading, setLoading] = useState(!!id);
  const [file, setFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existingUrl = useImageUrl("question-images", removeImage ? null : form.image_path);

  useEffect(() => {
    if (!id) return;
    supabase
      .from("questions")
      .select("*")
      .eq("id", id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) setError("Frage nicht gefunden.");
        else {
          const q = data as Question;
          setForm({
            category_id: String(q.category_id),
            text: q.text,
            correct: q.correct,
            wrong_1: q.wrong_1,
            wrong_2: q.wrong_2,
            wrong_3: q.wrong_3,
            explanation: q.explanation ?? "",
            source_url: q.source_url ?? "",
            is_active: q.is_active,
            image_path: q.image_path,
          });
        }
        setLoading(false);
      });
  }, [id]);

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const answers = [form.correct, form.wrong_1, form.wrong_2, form.wrong_3].map((a) => a.trim().toLowerCase());
    if (new Set(answers).size < 4) return setError("Die vier Antworten müssen sich unterscheiden.");
    if (form.source_url && !/^https?:\/\//i.test(form.source_url.trim())) return setError("Die Quelle muss mit https:// beginnen.");
    setBusy(true);
    try {
      let image_path = removeImage ? null : form.image_path;
      if (file) image_path = await uploadImage("question-images", profile!.id, file);
      const row = {
        category_id: Number(form.category_id),
        text: form.text.trim(),
        correct: form.correct.trim(),
        wrong_1: form.wrong_1.trim(),
        wrong_2: form.wrong_2.trim(),
        wrong_3: form.wrong_3.trim(),
        explanation: form.explanation.trim() || null,
        source_url: form.source_url.trim() || null,
        is_active: form.is_active,
        image_path,
      };
      const { error } = id
        ? await supabase.from("questions").update(row).eq("id", id)
        : await supabase.from("questions").insert({ ...row, author_id: profile!.id });
      if (error) throw error;
      if ((file || removeImage) && form.image_path && form.image_path !== image_path) await deleteImage("question-images", form.image_path);
      toast(id ? "Frage gespeichert." : "Frage ist live!");
      if (id) navigate("/fragen");
      else {
        setForm({ ...empty, category_id: form.category_id });
        setFile(null);
        window.scrollTo(0, 0);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!id || !confirm("Frage wirklich löschen? Schon gespielte Fragen bleiben in alten Spielen sichtbar.")) return;
    try {
      await rpc("delete_question", { p_question_id: id });
      toast("Frage gelöscht.");
      navigate("/fragen");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (loading) return <Loading />;

  return (
    <Page title={id ? "Frage bearbeiten" : "Neue Frage"} back={() => navigate("/fragen")}>
      <form className="form" onSubmit={save}>
        <label className="field">
          <span>Kategorie</span>
          <select value={form.category_id} onChange={set("category_id")} required>
            <option value="" disabled>
              Bitte wählen
            </option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Frage</span>
          <textarea value={form.text} onChange={set("text")} rows={3} minLength={5} maxLength={300} required placeholder="z. B. Wie viele Herzen hat ein Oktopus?" />
          <small className="muted">{form.text.length}/300</small>
        </label>

        <ImagePicker
          file={file}
          onChange={(f) => {
            setFile(f);
            if (f) setRemoveImage(false);
          }}
          existingUrl={existingUrl}
          onRemoveExisting={() => setRemoveImage(true)}
        />

        <fieldset className="answers-input">
          <legend>Antworten</legend>
          <label className="field field-correct">
            <span>Richtige Antwort</span>
            <input value={form.correct} onChange={set("correct")} maxLength={120} required placeholder="z. B. 3" />
          </label>
          <label className="field field-wrong">
            <span>Falsche Antwort 1</span>
            <input value={form.wrong_1} onChange={set("wrong_1")} maxLength={120} required placeholder="z. B. 1" />
          </label>
          <label className="field field-wrong">
            <span>Falsche Antwort 2</span>
            <input value={form.wrong_2} onChange={set("wrong_2")} maxLength={120} required placeholder="z. B. 2" />
          </label>
          <label className="field field-wrong">
            <span>Falsche Antwort 3</span>
            <input value={form.wrong_3} onChange={set("wrong_3")} maxLength={120} required placeholder="z. B. 8" />
          </label>
          <p className="muted small">Beim Spielen werden die Antworten gemischt.</p>
        </fieldset>

        <label className="field">
          <span>Erklärung (optional)</span>
          <textarea value={form.explanation} onChange={set("explanation")} rows={2} maxLength={500} placeholder="Zwei pumpen Blut durch die Kiemen, eins durch den Körper." />
        </label>
        <label className="field">
          <span>Quelle (optional)</span>
          <input type="url" value={form.source_url} onChange={set("source_url")} placeholder="https://…" inputMode="url" />
        </label>

        {id && (
          <label className="check">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
            <span>Frage ist aktiv (wird in Spielen gestellt)</span>
          </label>
        )}

        <ErrorBox error={error} />
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Speichern …" : id ? "Änderungen speichern" : "Frage hochladen"}
        </button>
        {id && (
          <button type="button" className="btn btn-ghost btn-block danger" onClick={remove}>
            Frage löschen
          </button>
        )}
      </form>
    </Page>
  );
}
