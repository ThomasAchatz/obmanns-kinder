import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/hooks";
import { monthName } from "../lib/format";
import { disablePush, enablePush, isIos, isStandalone, pushState, type PushState } from "../lib/push";
import { navigate } from "../lib/router";
import { errorText, rpc, supabase } from "../lib/supabase";
import type { DayStatus, Kind, LeaderRow } from "../lib/types";
import { ErrorBox, Loading, Page, toast } from "../components/ui";

type CatStat = { category_id: number; name: string; icon: string; answered: number; correct: number; rate: number | null };
type Leader = { category_id: number; name: string; icon: string; user_id: string | null; display_name: string | null; answered: number | null; rate: number | null };
type Winner = { month: string; points: number; user_id: string; profiles: { display_name: string } | null };

const APK_URL = "https://github.com/ThomasAchatz/obmanns-kinder/releases/latest/download/obmanns-kinder.apk";
// In der Android-App (TWA) ist der Referrer android-app://…, dort braucht es den Link nicht.
const showApkLink =
  /android/i.test(navigator.userAgent) && !isStandalone() && !document.referrer.startsWith("android-app://");

export function ProfilePage() {
  const { profile, signOut, reloadProfile } = useAuth();
  const [period, setPeriod] = useState<"month" | "all">("month");
  const [kind, setKind] = useState<Kind>("quiz");
  const board = useLoad(() => rpc<LeaderRow[]>("leaderboard", { p_period: period, p_kind: kind }), [period, kind]);
  const day = useLoad(() => rpc<DayStatus>("my_day_status", { p_kind: kind }), [kind]);
  const stats = useLoad(() => rpc<CatStat[]>("category_stats"));
  const leaders = useLoad(() => rpc<Leader[]>("category_leaders"));
  const winners = useLoad(async () => {
    const { data, error } = await supabase
      .from("monthly_results")
      .select("month, points, user_id, profiles!monthly_results_user_id_fkey(display_name)")
      .eq("rank", 1)
      .order("month", { ascending: false })
      .limit(12);
    if (error) throw error;
    return data as unknown as Winner[];
  });

  // Für den Obmann: wie viele Spieler-Fragen seit dem letzten Blick in den Admin-Bereich?
  const newQuestions = useLoad(async () => {
    if (!profile!.is_admin) return 0;
    let seen = 0;
    try {
      seen = Number(localStorage.getItem("obmanns-admin-fragen-gesehen")) || 0;
    } catch {
      /* privater Modus */
    }
    const { count } = await supabase
      .from("questions")
      .select("id", { count: "exact", head: true })
      .not("author_id", "is", null)
      .is("deleted_at", null)
      .gt("created_at", new Date(seen).toISOString());
    return count ?? 0;
  });

  const [push, setPush] = useState<PushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    pushState().then(setPush);
  }, []);

  const [name, setName] = useState(profile!.display_name);
  async function saveName() {
    const { error } = await supabase.from("profiles").update({ display_name: name.trim() }).eq("id", profile!.id);
    if (error) return toast(errorText(error));
    await reloadProfile();
    toast("Name gespeichert.");
  }

  async function togglePush() {
    setPushBusy(true);
    try {
      if (push === "on") await disablePush();
      else await enablePush();
      setPush(await pushState());
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setPushBusy(false);
    }
  }

  const rows = (board.data ?? []).filter((r) => period === "all" || r.games > 0);

  return (
    <Page title={profile!.display_name}>
      <section className="section">
        <div className="segmented board-switch" role="tablist" aria-label="Rangliste">
          {(["quiz", "music"] as Kind[]).map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "seg active" : "seg"} onClick={() => setKind(k)}>
              {k === "quiz" ? "Quiz" : "Musik"}
            </button>
          ))}
        </div>
        <div className="section-head">
          <h2>Rangliste {kind === "music" ? "Musik" : "Quiz"}</h2>
          <div className="segmented segmented-small" role="tablist">
            <button role="tab" aria-selected={period === "month"} className={period === "month" ? "seg active" : "seg"} onClick={() => setPeriod("month")}>
              {monthName(new Date()).split(" ")[0]}
            </button>
            <button role="tab" aria-selected={period === "all"} className={period === "all" ? "seg active" : "seg"} onClick={() => setPeriod("all")}>
              Gesamt
            </button>
          </div>
        </div>
        <ErrorBox error={board.error} retry={board.reload} />
        {board.loading && !board.data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <p className="muted">In diesem Monat wurde noch kein {kind === "music" ? "Musik-Duell" : "Duell"} beendet.</p>
        ) : (
          <table className="board">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Name</th>
                <th scope="col" className="num">Punkte</th>
                <th scope="col" className="num">Siege</th>
                <th scope="col" className="num">Quote</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.user_id} className={r.user_id === profile!.id ? "me" : ""}>
                  <td>{i + 1}</td>
                  <td>{r.display_name}</td>
                  <td className="num points">{r.points}</td>
                  <td className="num">
                    {r.wins}/{r.games}
                  </td>
                  <td className="num">{r.correct_rate} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {day.data && (
          <p className="day-status">
            Heute: {day.data.counted_games} von {day.data.limit_games} Wertungsspielen · {day.data.points} von {day.data.limit_points} Punkten
          </p>
        )}
        <p className="muted small">
          {kind === "music" && "Musik hat eine eigene Rangliste und ein eigenes Tageslimit. Pro Song gibt es bis zu 2 Treffer (Interpret und Titel). "}
          Duell: Sieg 3, Unentschieden 1 Punkt. Challenge: Platz 1–3 bekommt 3/2/1 Punkte. Pro Tag zählen nur die ersten 3 beendeten
          Spiele, also höchstens 9 Punkte. Weiterspielen geht immer.
        </p>
      </section>

      {(winners.data ?? []).length > 0 && (
        <section className="section">
          <h2>Monatssieger</h2>
          <ul className="plain-list">
            {winners.data!.map((w) => (
              <li key={w.month + w.user_id}>
                <span>{monthName(w.month)}</span>
                <span className="list-value">
                  {w.profiles?.display_name} <span className="muted">{w.points} P.</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section">
        <h2>Deine Trefferquote</h2>
        {stats.loading && !stats.data ? (
          <Loading />
        ) : (
          <ul className="meters">
            {(stats.data ?? []).map((s) => (
              <li key={s.category_id} className={s.answered ? "" : "is-empty"}>
                <span className="meter-label">
                  <span className="meter-icon" aria-hidden="true">
                    {s.icon}
                  </span>
                  {s.name}
                </span>
                <span className="meter-value">
                  {s.answered ? (
                    <>
                      {s.rate} %<span className="meter-sub"> · {s.correct}/{s.answered}</span>
                    </>
                  ) : (
                    "noch nicht gespielt"
                  )}
                </span>
                <span className="meter-track" aria-hidden="true">
                  <span className="meter-fill" style={{ width: `${s.answered ? s.rate ?? 0 : 0}%` }} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(leaders.data ?? []).some((l) => l.user_id) && (
        <section className="section">
          <h2>Schützenkönige je Kategorie</h2>
          <ul className="plain-list">
            {leaders.data!
              .filter((l) => l.user_id)
              .map((l) => (
                <li key={l.category_id}>
                  <span>
                    <span className="meter-icon" aria-hidden="true">
                      {l.icon}
                    </span>
                    {l.name}
                  </span>
                  <span className="list-value">
                    {l.display_name} <span className="muted">{l.rate} %</span>
                  </span>
                </li>
              ))}
          </ul>
          <p className="muted small">Ab 5 beantworteten Fragen in der Kategorie.</p>
        </section>
      )}

      <section className="section">
        <h2>Einstellungen</h2>
        <div className="setting">
          <div>
            <p className="strong">Benachrichtigungen</p>
            <p className="muted small">
              {push === "on" && "An auf diesem Gerät."}
              {push === "off" && "Bei Herausforderungen, Ergebnissen und zum Monatsende."}
              {push === "denied" && "Im Browser blockiert. Erlaube Benachrichtigungen in den Website-Einstellungen."}
              {push === "needs-install" && "Auf dem iPhone: Teilen → „Zum Home-Bildschirm“, dann die App von dort öffnen."}
              {push === "unsupported" && (isIos() ? "Dein iPhone braucht mindestens iOS 16.4." : "Dieser Browser unterstützt keine Benachrichtigungen.")}
            </p>
          </div>
          {(push === "on" || push === "off") && (
            <button className={push === "on" ? "switch on" : "switch"} role="switch" aria-checked={push === "on"} disabled={pushBusy} onClick={togglePush}>
              <span className="visually-hidden">Benachrichtigungen</span>
            </button>
          )}
        </div>
        {showApkLink && (
          <div className="setting">
            <div>
              <p className="strong">Android-App</p>
              <p className="muted small">Als richtige App installieren, mit eigenem Eintrag in der App-Übersicht.</p>
            </div>
            <a className="btn btn-small" href={APK_URL}>
              Herunterladen
            </a>
          </div>
        )}
        <div className="field-inline">
          <label className="field">
            <span>Anzeigename</span>
            <input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="btn" disabled={!name.trim() || name.trim() === profile!.display_name} onClick={saveName}>
            Speichern
          </button>
        </div>
        <p className="muted small">Benutzername: {profile!.username}. Passwort ändern geht über den Obmann.</p>
      </section>

      {profile!.is_admin && (
        <button className="btn btn-block" onClick={() => navigate("/admin")}>
          Admin-Bereich
          {(newQuestions.data ?? 0) > 0 && (
            <span className="pill pill-brass">
              {newQuestions.data} {newQuestions.data === 1 ? "neue Frage" : "neue Fragen"}
            </span>
          )}
        </button>
      )}
      <button className="btn btn-ghost btn-block" onClick={signOut}>
        Abmelden
      </button>
    </Page>
  );
}
