import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { playClip, stopClip, unlockAudio, audio } from "../lib/audio";
import { GENRES } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { navigate } from "../lib/router";
import { errorText, invoke, supabase } from "../lib/supabase";
import type { SongSearchHit } from "../lib/types";
import { Icon } from "../components/Icon";
import { Empty, ErrorBox, Loading, Page, toast } from "../components/ui";

type MySong = { id: number; artist: string; title: string; genre: string | null; decade: number | null; artwork_url: string | null };

function guessGenre(itunes: string | null): string {
  const g = (itunes ?? "").toLowerCase();
  if (/schlager|volksmusik/.test(g)) return "Schlager";
  if (/deutsch.?rap/.test(g)) return "Deutschrap";
  if (/deutsch.?rock/.test(g)) return "Deutschrock";
  if (/deutsch.?pop|deutsche musik|german pop/.test(g)) return "Deutschpop";
  if (/rap|hip/.test(g)) return "Hip-Hop";
  if (/disco/.test(g)) return "Disco";
  if (/dance|electro|house|techno|edm/.test(g)) return "Dance";
  if (/soul|r&b|rhythm/.test(g)) return "Soul";
  if (/reggae/.test(g)) return "Reggae";
  if (/oldies/.test(g)) return "Oldies";
  if (/rock|metal|alternative|punk|indie/.test(g)) return "Rock";
  return "Pop";
}

export function SongAddPage() {
  const { profile } = useAuth();
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<SongSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState<number | null>(null);
  const [chosen, setChosen] = useState<SongSearchHit | null>(null);
  const [genre, setGenre] = useState<string>("Pop");
  const [saving, setSaving] = useState(false);

  const mine = useLoad(async () => {
    const { data, error } = await supabase
      .from("songs")
      .select("id, artist, title, genre, decade, artwork_url")
      .eq("added_by", profile!.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data as MySong[];
  });

  // Suche mit kurzer Verzögerung
  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const r = await invoke<{ results: SongSearchHit[] }>("music", { action: "search", term: q });
        setHits(r.results);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [term]);

  useEffect(() => {
    const a = audio();
    const off = () => setListening(null);
    a.addEventListener("ended", off);
    return () => {
      a.removeEventListener("ended", off);
      stopClip();
    };
  }, []);

  async function listen(h: SongSearchHit) {
    if (listening === h.itunes_id) {
      stopClip();
      setListening(null);
      return;
    }
    unlockAudio();
    setListening(h.itunes_id);
    if (!(await playClip(h.preview_url))) setListening(null);
  }

  function choose(h: SongSearchHit) {
    setChosen(h);
    setGenre(guessGenre(h.itunes_genre));
  }

  async function save() {
    if (!chosen) return;
    setSaving(true);
    const decade = chosen.year ? Math.floor(chosen.year / 10) * 10 : null;
    const { error } = await supabase.from("songs").insert({
      itunes_id: chosen.itunes_id,
      artist: chosen.artist,
      title: chosen.title,
      genre,
      decade,
      artwork_url: chosen.artwork_url,
      preview_url: chosen.preview_url,
    });
    setSaving(false);
    if (error) {
      toast(/duplicate|unique/i.test(error.message) ? "Den Song gibt es schon." : errorText(error));
      return;
    }
    toast("Song ist im Pool. Deine Mitspieler bekommen ihn, du nie.");
    setHits((x) => x?.map((h) => (h.itunes_id === chosen.itunes_id ? { ...h, known: true } : h)) ?? null);
    setChosen(null);
    mine.reload();
  }

  async function remove(s: MySong) {
    const { error } = await supabase.from("songs").update({ is_active: false }).eq("id", s.id);
    if (error) return toast(errorText(error));
    toast("Song pausiert.");
    mine.reload();
  }

  return (
    <Page title="Song hinzufügen" back={() => navigate("/fragen")}>
      <p className="lead">Such nach Interpret oder Titel. Jeder Song spielt in der Runde 30 Sekunden, du selbst bekommst deine Songs nie.</p>
      <label className="search-field">
        <Icon name="search" size={18} />
        <input
          type="search"
          inputMode="search"
          placeholder="z. B. Spider Murphy Gang Skandal"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          autoFocus
        />
      </label>
      <ErrorBox error={error} />

      {chosen && (
        <div className="song-confirm">
          <div className="song-row">
            <span className="song-cover">{chosen.artwork_url ? <img src={chosen.artwork_url} alt="" /> : <Icon name="music" />}</span>
            <div className="song-meta">
              <p className="song-title">{chosen.title}</p>
              <p className="song-artist">
                {chosen.artist}
                {chosen.year ? ` · ${chosen.year}` : ""}
              </p>
            </div>
          </div>
          <label className="field">
            <span>Genre (für passende falsche Antworten)</span>
            <select value={genre} onChange={(e) => setGenre(e.target.value)}>
              {GENRES.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <div className="row-actions">
            <button className="btn btn-ghost" onClick={() => setChosen(null)}>
              Abbrechen
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "Speichert …" : "In den Pool"}
            </button>
          </div>
        </div>
      )}

      {searching && !hits && <Loading text="Sucht …" />}
      {hits && hits.length === 0 && <p className="muted">Nichts gefunden. Versuch es mit Interpret und Titel zusammen.</p>}
      {hits && hits.length > 0 && (
        <ol className="song-list">
          {hits.map((h) => (
            <li key={h.itunes_id} className="song-row">
              <button
                className={listening === h.itunes_id ? "song-cover is-playing" : "song-cover"}
                onClick={() => listen(h)}
                aria-label={listening === h.itunes_id ? "Anhören stoppen" : `${h.title} anhören`}
              >
                {h.artwork_url ? <img src={h.artwork_url} alt="" loading="lazy" /> : <Icon name="music" />}
                <span className="song-cover-btn">
                  <Icon name={listening === h.itunes_id ? "pause" : "playTri"} filled size={16} />
                </span>
              </button>
              <div className="song-meta">
                <p className="song-title">{h.title}</p>
                <p className="song-artist">
                  {h.artist}
                  {h.year ? ` · ${h.year}` : ""}
                </p>
              </div>
              {h.known ? (
                <span className="pill">schon drin</span>
              ) : (
                <button className="btn btn-small btn-ghost" onClick={() => choose(h)}>
                  Nehmen
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      <section className="section">
        <h2>Meine Songs</h2>
        <ErrorBox error={mine.error} retry={mine.reload} />
        {mine.loading && !mine.data ? (
          <Loading />
        ) : (mine.data ?? []).length === 0 ? (
          <Empty>
            <p>Du hast noch keine Songs beigesteuert.</p>
          </Empty>
        ) : (
          <ol className="song-list">
            {mine.data!.map((s) => (
              <li key={s.id} className="song-row">
                <span className="song-cover">{s.artwork_url ? <img src={s.artwork_url} alt="" loading="lazy" /> : <Icon name="music" />}</span>
                <div className="song-meta">
                  <p className="song-title">{s.title}</p>
                  <p className="song-artist">
                    {s.artist}
                    {s.genre ? ` · ${s.genre}` : ""}
                  </p>
                </div>
                <button className="icon-btn" aria-label="Song pausieren" onClick={() => remove(s)}>
                  <Icon name="trash" size={18} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </Page>
  );
}
