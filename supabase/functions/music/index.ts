// Musikrunde: Songsuche bei iTunes und frische Vorschau-Links.
// Aktionen:
//   search  { term }     → Treffer mit 30-Sekunden-Vorschau (für „Song hinzufügen“)
//   refresh { song_id }  → holt einen neuen Vorschau-Link, falls der alte nicht mehr spielt
//   catalog { itunes_id } → legt die bekanntesten Songs dieses Interpreten im Katalog an
//                           (Vorschlagsliste im Hard-Mode)
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

type ITunesTrack = {
  kind?: string;
  wrapperType?: string;
  artistId?: number;
  trackId: number;
  artistName: string;
  trackName: string;
  collectionName?: string;
  previewUrl?: string;
  artworkUrl100?: string;
  primaryGenreName?: string;
  releaseDate?: string;
};

async function itunes(path: string, params: Record<string, string>): Promise<ITunesTrack[]> {
  const res = await fetch(`https://itunes.apple.com/${path}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(res.status === 403 || res.status === 429
    ? "iTunes bremst gerade. Versuch es in einer Minute nochmal."
    : `iTunes antwortet nicht (${res.status}).`);
  return (await res.json()).results ?? [];
}

const JUNK = /\b(live|remix|mix|karaoke|instrumental|acoustic|version|edit|demo|intro|interlude|medley|reprise|session|unplugged|mtv|commentary|skit)\b/i;

const bigArtwork = (u?: string) => (u ? u.replace(/\/\d+x\d+bb\./, "/400x400bb.") : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: userData } = await admin.auth.getUser(token);
    const user = userData.user;
    if (!user) return json({ error: "Nicht angemeldet." }, 401);

    const body = await req.json();

    switch (body.action) {
      case "search": {
        const term = String(body.term ?? "").trim().slice(0, 100);
        if (term.length < 2) return json({ results: [] });
        const tracks = (await itunes("search", { term, country: "DE", media: "music", entity: "song", limit: "20" }))
          .filter((t) => t.kind === "song" && t.previewUrl);
        const ids = tracks.map((t) => t.trackId);
        const { data: known } = await admin.from("songs").select("itunes_id").in("itunes_id", ids.length ? ids : [0]);
        const knownIds = new Set((known ?? []).map((k) => Number(k.itunes_id)));
        const year = (t: ITunesTrack) => (t.releaseDate ? Number(t.releaseDate.slice(0, 4)) : null);
        return json({
          results: tracks.map((t) => ({
            itunes_id: t.trackId,
            artist: t.artistName,
            title: t.trackName,
            album: t.collectionName ?? null,
            artwork_url: bigArtwork(t.artworkUrl100),
            preview_url: t.previewUrl,
            itunes_genre: t.primaryGenreName ?? null,
            year: year(t),
            known: knownIds.has(t.trackId),
          })),
        });
      }

      case "refresh": {
        const songId = Number(body.song_id);
        // Nur für Songs aus einem eigenen Spiel
        const { data: mine } = await admin.from("game_players").select("game_id").eq("user_id", user.id);
        const gameIds = (mine ?? []).map((g) => g.game_id);
        const { data: rows } = await admin
          .from("music_game_songs")
          .select("game_id")
          .eq("song_id", songId)
          .in("game_id", gameIds.length ? gameIds : [0])
          .limit(1);
        if (!rows?.length) return json({ error: "Song nicht gefunden." }, 404);

        const { data: song } = await admin.from("songs").select("itunes_id").eq("id", songId).single();
        if (!song?.itunes_id) return json({ error: "Song nicht gefunden." }, 404);
        let track: ITunesTrack | undefined;
        for (const country of ["DE", "US"]) {
          track = (await itunes("lookup", { id: String(song.itunes_id), country })).find((t) => t.previewUrl);
          if (track) break;
        }
        if (!track?.previewUrl) return json({ error: "Für diesen Song gibt es gerade keine Vorschau." }, 404);
        await admin.from("songs").update({ preview_url: track.previewUrl }).eq("id", songId);
        return json({ preview_url: track.previewUrl });
      }

      case "catalog": {
        const trackId = Number(body.itunes_id);
        const { data: song } = await admin.from("songs").select("id").eq("itunes_id", trackId).maybeSingle();
        if (!song) return json({ error: "Song nicht im Pool." }, 404);
        const track = (await itunes("lookup", { id: String(trackId), country: "DE" }))[0]
          ?? (await itunes("lookup", { id: String(trackId), country: "US" }))[0];
        if (!track?.artistId) return json({ added: 0 });
        const songs = (await itunes("lookup", { id: String(track.artistId), entity: "song", limit: "50", country: "DE" }))
          .filter((t) => t.wrapperType === "track" && t.kind === "song" && !JUNK.test(t.trackName));
        const rows = songs.map((t) => ({ itunes_id: t.trackId, artist: t.artistName.slice(0, 160), title: t.trackName.slice(0, 200) }));
        if (rows.length) {
          const { error } = await admin.from("song_catalog").upsert(rows, { onConflict: "norm_artist,norm_title", ignoreDuplicates: true });
          if (error) throw error;
        }
        return json({ added: rows.length });
      }

      default:
        return json({ error: "Unbekannte Aktion." }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
