import { useState } from "react";
import { useAuth } from "../lib/auth";
import { errorText, supabase } from "../lib/supabase";
import { Icon } from "./Icon";
import { toast } from "./ui";

const reasons = [
  { id: "falsch", label: "Lösung ist falsch" },
  { id: "doppelt", label: "Frage gibt es doppelt" },
  { id: "unpassend", label: "Unpassend" },
  { id: "sonstiges", label: "Sonstiges" },
];

/** Daumen hoch/runter und „Frage melden“ */
export function QuestionFeedback({ questionId, initialVote }: { questionId: number; initialVote: number | null }) {
  const { profile } = useAuth();
  const [vote, setVote] = useState<number | null>(initialVote);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("falsch");
  const [comment, setComment] = useState("");
  const [reported, setReported] = useState(false);

  async function cast(v: 1 | -1) {
    const next = vote === v ? null : v;
    const prev = vote;
    setVote(next);
    const q =
      next === null
        ? supabase.from("question_votes").delete().eq("question_id", questionId).eq("user_id", profile!.id)
        : supabase.from("question_votes").upsert({ question_id: questionId, user_id: profile!.id, vote: next });
    const { error } = await q;
    if (error) {
      setVote(prev);
      toast(errorText(error));
    }
  }

  async function report() {
    const { error } = await supabase
      .from("question_reports")
      .insert({ question_id: questionId, reason, comment: comment.trim() || null });
    if (error) return toast(errorText(error));
    setReported(true);
    setReporting(false);
    toast("Danke, der Obmann schaut sich das an.");
  }

  return (
    <div className="feedback">
      <div className="feedback-row">
        <span className="muted small">Gute Frage?</span>
        <button className={vote === 1 ? "icon-btn on good" : "icon-btn"} aria-pressed={vote === 1} aria-label="Gute Frage" onClick={() => cast(1)}>
          <Icon name="thumbUp" size={20} />
        </button>
        <button className={vote === -1 ? "icon-btn on bad" : "icon-btn"} aria-pressed={vote === -1} aria-label="Schlechte Frage" onClick={() => cast(-1)}>
          <Icon name="thumbDown" size={20} />
        </button>
        {!reported && (
          <button className="link-btn feedback-report" onClick={() => setReporting((x) => !x)}>
            <Icon name="flag" size={16} /> Melden
          </button>
        )}
      </div>
      {reporting && (
        <div className="report-box">
          <label className="field">
            <span>Was stimmt nicht?</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Kommentar (optional)</span>
            <input value={comment} maxLength={300} onChange={(e) => setComment(e.target.value)} />
          </label>
          <button className="btn btn-small" onClick={report}>
            Frage melden
          </button>
        </div>
      )}
    </div>
  );
}
