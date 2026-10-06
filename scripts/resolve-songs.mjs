// Löst die Songs aus music/startpaket.json über die iTunes Search API auf
// (kostenlos, ohne Schlüssel) und schreibt eine Migration mit den neu gefundenen Songs.
//
//   node scripts/resolve-songs.mjs
//
// Ergebnisse werden in music/resolved.json zwischengespeichert, damit bei weiteren
// Läufen nur neue Einträge abgefragt werden. Läuft in GitHub Actions (music-seed.yml).

import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";

const LIST = "music/startpaket.json";
const CACHE = "music/resolved.json";
const PAUSE_MS = 3200; // iTunes erlaubt etwa 20 Anfragen pro Minute

const songs = JSON.parse(readFileSync(LIST, "utf8"));
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

const key = (s) => `${s.artist}|${s.title}`;

function norm(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/\s*[([].*?[)\]]\s*/g, " ") // (Remastered), [Live] …
    .replace(/\s+-\s+.*$/, "") // "Titel - Remastered 2011"
    .replace(/\bfeat\.?.*$/, "")
    .replace(/&/g, "and")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function artistMatches(want, got) {
  const a = norm(want);
  const b = norm(got);
  return a === b || b.startsWith(a) || a.startsWith(b) || b.includes(a);
}

function titleMatches(want, got) {
  const a = norm(want);
  const b = norm(got);
  return a === b || b.startsWith(a) || a.startsWith(b);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(term, country) {
  const url = `https://itunes.apple.com/search?${new URLSearchParams({
    term,
    country,
    media: "music",
    entity: "song",
    limit: "25",
  })}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "obmanns-kinder-seed/1.0" } });
    if (res.ok) return (await res.json()).results ?? [];
    if (res.status === 403 || res.status === 429) {
      await sleep(30000 * (attempt + 1));
      continue;
    }
    throw new Error(`iTunes ${res.status} für ${term}`);
  }
  throw new Error(`iTunes antwortet nicht für ${term}`);
}

function pick(results, s) {
  const hits = results.filter(
    (r) => r.previewUrl && r.kind === "song" && artistMatches(s.artist, r.artistName) && titleMatches(s.title, r.trackName),
  );
  if (!hits.length) return null;
  // Lieber Original als Live/Remix/Karaoke, lieber kurzer Titel, lieber älter
  const score = (r) =>
    (/(live|remix|karaoke|instrumental|acoustic|version|edit\)|mix\))/i.test(r.trackName + " " + r.collectionName) ? 10 : 0) +
    (norm(r.trackName) === norm(s.title) ? 0 : 2);
  hits.sort((x, y) => score(x) - score(y) || (x.releaseDate ?? "").localeCompare(y.releaseDate ?? ""));
  const r = hits[0];
  return {
    itunes_id: r.trackId,
    preview_url: r.previewUrl,
    artwork_url: (r.artworkUrl100 ?? "").replace(/\/\d+x\d+bb\./, "/400x400bb."),
  };
}

let fresh = 0;
const missing = [];
for (const s of songs) {
  const k = key(s);
  if (k in cache && cache[k]) continue;
  let found = null;
  for (const country of ["DE", "US"]) {
    const results = await search(`${s.artist} ${s.title}`, country);
    found = pick(results, s);
    await sleep(PAUSE_MS);
    if (found) break;
  }
  cache[k] = found;
  if (found) fresh++;
  else missing.push(k);
  console.log(found ? "✓" : "✗", k);
}

writeFileSync(CACHE, JSON.stringify(cache, null, 1) + "\n");

// Migration mit allen gefundenen Songs (idempotent: schon vorhandene werden übersprungen)
const sql = (v) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const seen = new Set();
const rows = songs
  .map((s) => ({ s, r: cache[key(s)] }))
  .filter(({ r }) => r && !seen.has(r.itunes_id) && seen.add(r.itunes_id))
  .map(
    ({ s, r }) =>
      `  (${r.itunes_id}, ${sql(s.artist)}, ${sql(s.title)}, ${sql(s.genre)}, ${s.decade ?? "null"}, ${sql(r.artwork_url)}, ${sql(r.preview_url)}, 'startpaket', null)`,
  );

if (fresh > 0) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const file = `supabase/migrations/${stamp}_songs_startpaket.sql`;
  writeFileSync(
    file,
    `-- Erzeugt von scripts/resolve-songs.mjs (iTunes Search API)\n` +
      `insert into public.songs (itunes_id, artist, title, genre, decade, artwork_url, preview_url, source, added_by) values\n` +
      rows.join(",\n") +
      `\non conflict (itunes_id) do nothing;\n`,
  );
  console.log(`Migration geschrieben: ${file}`);
}

const summary =
  `### Song-Startpaket\n\n` +
  `- Songs in der Liste: ${songs.length}\n- Gefunden insgesamt: ${rows.length}\n- Neu in diesem Lauf: ${fresh}\n` +
  (missing.length ? `\n**Nicht gefunden (${missing.length}):**\n\n${missing.map((m) => `- ${m}`).join("\n")}\n` : "");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `fresh=${fresh}\n`);
