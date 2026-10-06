// Baut den Song-Katalog für die Vorschlagsliste im Hard-Mode:
// Für jeden Interpreten aus dem Startpaket werden seine bekanntesten Songs bei iTunes
// geholt. So reicht es im Hard-Mode nicht, nur den Interpreten zu erkennen.
//
//   node scripts/build-catalog.mjs      (nach resolve-songs.mjs)
//
// Zwischenspeicher: music/catalog.json. Läuft in GitHub Actions (music-seed.yml).

import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";

const RESOLVED = "music/resolved.json";
const CACHE = "music/catalog.json";
const PAUSE_MS = 3200;
const PER_ARTIST = 50;

const resolved = JSON.parse(readFileSync(RESOLVED, "utf8"));
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : { trackArtist: {}, artists: {} };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lookup(params) {
  const url = `https://itunes.apple.com/lookup?${new URLSearchParams(params)}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "obmanns-kinder-seed/1.0" } });
    if (res.ok) return (await res.json()).results ?? [];
    if (res.status === 403 || res.status === 429) {
      await sleep(30000 * (attempt + 1));
      continue;
    }
    throw new Error(`iTunes ${res.status}`);
  }
  throw new Error("iTunes antwortet nicht");
}

function norm(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/\s*[([].*?[)\]]\s*/g, " ")
    .replace(/\s+-\s+.*$/, "")
    .replace(/[^a-z0-9]+/g, "");
}

const JUNK = /\b(live|remix|mix|karaoke|instrumental|acoustic|version|edit|demo|intro|interlude|medley|reprise|session|unplugged|mtv|commentary|skit)\b/i;

// 1. Zu welchem Interpreten gehört jeder Song aus dem Pool?
const trackIds = Object.values(resolved)
  .filter(Boolean)
  .map((r) => String(r.itunes_id))
  .filter((id) => !(id in cache.trackArtist));
for (let i = 0; i < trackIds.length; i += 150) {
  const batch = trackIds.slice(i, i + 150);
  for (const country of ["DE", "US"]) {
    const open = batch.filter((id) => !(id in cache.trackArtist));
    if (!open.length) break;
    for (const r of await lookup({ id: open.join(","), country })) {
      if (r.trackId && r.artistId) cache.trackArtist[String(r.trackId)] = r.artistId;
    }
    await sleep(PAUSE_MS);
  }
}

// 2. Bekannteste Songs je Interpret
const artistIds = [...new Set(Object.values(cache.trackArtist).map(String))].filter((id) => !(id in cache.artists));
let fresh = 0;
for (const id of artistIds) {
  let songs = [];
  for (const country of ["DE", "US"]) {
    const results = await lookup({ id, entity: "song", limit: String(PER_ARTIST), country });
    await sleep(PAUSE_MS);
    songs = results.filter((r) => r.wrapperType === "track" && r.kind === "song");
    if (songs.length) break;
  }
  const seen = new Set();
  const list = [];
  for (const r of songs) {
    if (JUNK.test(r.trackName)) continue;
    const k = norm(r.artistName) + "|" + norm(r.trackName);
    if (!norm(r.trackName) || seen.has(k)) continue;
    seen.add(k);
    list.push([r.trackId, r.artistName, r.trackName]);
  }
  cache.artists[id] = list;
  fresh++;
  console.log(`${list.length.toString().padStart(3)} Songs: ${songs[0]?.artistName ?? id}`);
}

writeFileSync(CACHE, JSON.stringify(cache) + "\n");

const all = Object.values(cache.artists).flat();
if (fresh > 0) {
  const sql = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const file = `supabase/migrations/${stamp}_song_katalog.sql`;
  writeFileSync(
    file,
    `-- Erzeugt von scripts/build-catalog.mjs (iTunes Lookup API)\n` +
      `insert into public.song_catalog (itunes_id, artist, title) values\n` +
      all.map(([tid, a, t]) => `  (${tid}, ${sql(a.slice(0, 160))}, ${sql(t.slice(0, 200))})`).join(",\n") +
      `\non conflict (norm_artist, norm_title) do nothing;\n`,
  );
  console.log(`Migration geschrieben: ${file}`);
}

const summary = `\n### Song-Katalog (Hard-Mode)\n\n- Interpreten: ${Object.keys(cache.artists).length} (neu: ${fresh})\n- Songs im Katalog: ${all.length}\n`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
