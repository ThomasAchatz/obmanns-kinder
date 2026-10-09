"""Bilderrunde, Schritt 2: aus der gesichteten Shortlist das Startpaket bauen.

Aufruf: python3 scripts/portraits-seed.py <ordner-mit-pool.json-katalog.json-crops> <auswahl.json>
- auswahl.json enthält die Ausschlüsse aus der Sichtung (Indizes in pool.json),
  Indizes, die nur in den Hard-Mode sollen, und Namens-Korrekturen.
- Schreibt public/bilder/<zufall>.jpg, bilder/portraits.json und eine Migration.
Die Fotos stammen von Wikimedia Commons (freie Lizenzen), Urheber und Lizenz
werden in der App bei jedem Bild angezeigt."""
import hashlib, json, math, os, re, sys, time
from PIL import Image

SRC, PICK = sys.argv[1], sys.argv[2]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pool = json.load(open(os.path.join(SRC, "pool.json")))
katalog = json.load(open(os.path.join(SRC, "katalog.json")))
pick = json.load(open(PICK))
reject = set(pick["reject"])
hard_only = set(pick["hard"])
renames = pick.get("rename", {})

SPARTEN = [
    ("Musik", r"sänger|musiker|rapper|komponist|songwriter|pianist|gitarrist|dirigent|schlagzeuger|\bband\b|\bdj\b|geiger|violinist|cellist|opern|liedermacher|popstar|rockstar"),
    ("Film & TV", r"schauspieler|moderator|regisseur|\bmodel\b|fotomodell|komiker|kabarettist|entertainer|webvideo|youtuber|influencer|drehbuch|filmproduzent|fernseh|showmaster|synchronsprecher|reality|filmemacher"),
    ("Sport", r"(fußball|tennis|basketball|eishockey|handball|golf|schach|volleyball|baseball|football)spieler|sportler|athlet|rennfahrer|schwimmer|skirennläufer|boxer|turner|radrennfahrer|läufer|springer|trainer|biathlet|eiskunstläufer|golfer|ringer|reiter|sprinter|torhüter|fußballer|bergsteiger|gymnastin|siebenkämpfer|zehnkämpfer|formel|olympiasieger|weltmeister|skispringer|skirennfahrer|kampfsportler|stabhochspringer"),
    ("Politik & Adel", r"politiker|staatsmann|monarch|könig|prinz|fürst|herzog|diplomat|richter|aktivist|präsident|kanzler|staatschef|regierungschef|staatsoberhaupt|machthaber|generalsekretär|premierminister|minister|first lady|kaiser|großherzog|bürgermeister"),
    ("Wissenschaft & Kultur", r"wissenschaftler|physiker|chemiker|biolog|mathematiker|astronaut|informatiker|ingenieur|mediziner|ökonom|philosoph|astronom|erfinder|forscher|schriftsteller|autor|dichter|journalist|unternehmer|manager|investor|designer|modeschöpfer|maler|bildhauer|künstler|fotograf|architekt|papst|bischof|dalai|theolog|geistlich|kardinal"),
]

def sparte_of(desc, occ):
    d = (desc or "").lower()
    best = None
    for name, rx in SPARTEN:
        m = re.search(rx, d)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), name)
    if best:
        return best[1]
    joined = " ".join(occ or []).lower()
    for name, rx in SPARTEN:
        if re.search(rx, joined):
            return name
    return "Wissenschaft & Kultur"

PATRONYM = re.compile(r"^\w+(owitsch|ewitsch|jewitsch|itsch|owna|ewna|jewna|ichna|inichna)$", re.I)

def display_name(p):
    if p["qid"] in renames:
        return renames[p["qid"]]
    n = re.sub(r"\s*\([^)]*\)\s*$", "", p["name"]).strip()   # „Tom Holland (Schauspieler)“
    parts = n.split()
    if len(parts) == 3 and PATRONYM.match(parts[1]):
        n = parts[0] + " " + parts[2]
    return n

def clean_desc(desc):
    d = re.sub(r"\s*\([^)]*\d[^)]*\)", "", desc or "").strip(" ,")   # Lebensdaten raus
    d = re.sub(r"\s+", " ", d)
    if len(d) > 110:
        d = d[:110].rsplit(",", 1)[0].rsplit(" ", 1)[0] + " …"
    return (d[:1].upper() + d[1:]) if d else ""

NAT = re.compile(r"^(?:[\w-]*(?:isch|ische|ischer|isches)|deutsche?r?|[\w-]+-?amerikanische?r?|us-amerikanische?r?|franko-[\w-]+|britisch-[\w-]+)$", re.I)

def short_sub(desc):
    d = re.sub(r"\s*\([^)]*\)", "", desc or "")
    d = re.split(r",|;", d)[0].strip()
    first, _, rest = d.partition(" und ")
    if rest and len(first.split()) >= 2:
        d = first
    words = d.split()
    while len(words) > 1 and NAT.match(words[0]):
        words = words[1:]
    s = " ".join(words)
    if len(s) > 38:
        s = s[:38].rsplit(" ", 1)[0] + " …"
    return s[:1].upper() + s[1:] if s else None

def norm(s):
    s = s.lower()
    s = s.translate(str.maketrans("äöüàáâãåāăąèéêëēėęěìíîïīįòóôõøōőùúûūůűñńňçćčšśşžźżýÿłđğřť", "aouaaaaaaaaeeeeeeeeiiiiiiooooooouuuuuunnncccssszzzyyldgrt")).replace("ß", "ss")
    return re.sub(r"[^a-z0-9]+", "", s)

def good_aliases(name, aliases):
    toks = {t.lower() for t in re.findall(r"[\wÀ-ž-]{3,}", name)}
    out = []
    for a in aliases or []:
        a = a.strip()
        if not a or len(a) > 60 or norm(a) == norm(name):
            continue
        atoks = {t.lower() for t in re.findall(r"[\wÀ-ž-]{3,}", a)}
        if (toks & atoks) or (len(name.split()) == 1 and len(a.split()) >= 2):
            out.append(a)
    return out[:6]

def lic(l):
    l = (l or "").strip()
    return "gemeinfrei" if re.match(r"(?i)^(public domain|pd)", l) else l

def artist(a):
    a = re.sub(r"\s+", " ", a or "").strip()
    a = re.sub(r"(?i)(unknown author|unbekannter? (urheber|autor)|author unknown)+", "unbekannt", a).strip(" ,")
    a = re.sub(r"(?i)^(unbekannt\s*)+", "unbekannt", a)
    if a.lower().startswith("all the photographs are in the public domain"):
        m = re.search(r'courtesy ([^".]+)', a, re.I)
        a = m.group(1).strip() if m else "Public Domain"
    if len(a) > 80:
        a = a[:78].rsplit(" ", 1)[0] + " …"
    return a or "unbekannt"

# ---------------------------------------------------------------------
chosen = [p for p in pool if p["idx"] not in reject]
for sex in ("w", "m"):
    group = sorted([p for p in chosen if p["sex"] == sex], key=lambda p: -p["score"])
    cut = int(len(group) * 0.58)
    for i, p in enumerate(group):
        p["level"] = 2 if (i >= cut or p["idx"] in hard_only) else 1

out_dir = os.path.join(ROOT, "public", "bilder")
os.makedirs(out_dir, exist_ok=True)
for f in os.listdir(out_dir):
    if f.endswith(".jpg"):
        os.remove(os.path.join(out_dir, f))
salt = pick.get("salt", "obmann")
rows = []
for p in chosen:
    name = display_name(p)
    fn = hashlib.sha256((salt + p["qid"]).encode()).hexdigest()[:16] + ".jpg"
    im = Image.open(os.path.join(SRC, "crops", p["qid"] + ".jpg")).convert("RGB").resize((400, 500), Image.LANCZOS)
    im.save(os.path.join(out_dir, fn), quality=80, optimize=True, progressive=True)
    aliases = good_aliases(name, ([p["name"]] if p["name"] != name else []) + (p.get("aliases") or []))
    desc = clean_desc(p.get("desc"))
    rows.append({
        "qid": p["qid"], "name": name, "aliases": aliases, "sex": p["sex"], "born": p["born"],
        "sparte": sparte_of(p.get("desc"), p.get("occ_labels")),
        "description": (desc + " · " if desc else "") + f"Jahrgang {p['born']}",
        "image": fn, "photo_year": p.get("photo_year"), "artist": artist(p.get("artist")), "license": lic(p.get("license")),
        "source_url": p.get("page"), "wiki_title": p.get("dewiki"), "level": p["level"],
    })

BAD_DESC = re.compile(r"(?i)porno|erotik|sexarbeit|terrorist|mörder|kriegsverbrech|söldner|verbrecher|attentäter|drogenhändler|kriminell|nationalsozialist|ss-|hingericht|entführ|missbrauch")

# Katalog: alle Porträts + bekannte weitere Personen (ohne Verurteilte, ohne Ausgeschlossene)
portrait_qids = {r["qid"] for r in rows}
rejected_qids = {p["qid"] for p in pool if p["idx"] in reject} | set(pick.get("reject_qids", []))
cat = {}
for k in katalog:
    if k["sex"] not in ("w", "m") or not k.get("born"):
        continue
    if k["qid"] in rejected_qids and k["qid"] not in portrait_qids:
        continue
    if k.get("convicted") and k["qid"] not in portrait_qids:
        continue
    if BAD_DESC.search(k.get("desc") or "") and k["qid"] not in portrait_qids:
        continue
    name = renames.get(k["qid"]) or display_name(k)
    cat[k["qid"]] = {
        "qid": k["qid"], "name": name, "sub": short_sub(k.get("desc")), "sex": k["sex"], "born": k["born"],
        "sparte": sparte_of(k.get("desc"), k.get("occ_labels")),
        "fame": round(math.log10((k.get("views") or 0) + 10), 3),
        "as_option": (k.get("views") or 0) >= 8000 and bool(k.get("desc")),
        "search": "|".join(dict.fromkeys([norm(name)] + [norm(a) for a in good_aliases(name, k.get("aliases"))])),
    }
for r in rows:  # Porträts immer im Katalog und als falsche Antwort möglich
    c = cat.setdefault(r["qid"], {"qid": r["qid"], "name": r["name"], "sub": None, "sex": r["sex"], "born": r["born"],
                                  "sparte": r["sparte"], "fame": 4.0, "as_option": True, "search": norm(r["name"])})
    c["name"], c["sparte"], c["as_option"] = r["name"], r["sparte"], True
    c["search"] = "|".join(dict.fromkeys([norm(r["name"])] + [norm(a) for a in r["aliases"]]))
    if not c["sub"]:
        c["sub"] = r["sparte"]

json.dump(rows, open(os.path.join(ROOT, "bilder", "portraits.json"), "w"), ensure_ascii=False, indent=1)

def q(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        return "array[" + ",".join(q(x) for x in v) + "]::text[]" if v else "'{}'::text[]"
    return "'" + str(v).replace("'", "''") + "'"

stamp = time.strftime("%Y%m%d%H%M%S", time.gmtime())
mig = os.path.join(ROOT, "supabase", "migrations", f"{pick.get('stamp', stamp)}_bilder_startpaket.sql")
with open(mig, "w") as f:
    f.write("-- Bilderrunde: Startpaket (generiert von scripts/portraits-seed.py, nicht von Hand ändern)\n")
    f.write(f"-- {len(rows)} Porträts, {len(cat)} Namen im Katalog. Fotos: Wikimedia Commons.\n\n")
    cols = "qid, name, aliases, sex, born, sparte, description, image, photo_year, artist, license, source_url, wiki_title, level"
    for i in range(0, len(rows), 100):
        f.write(f"insert into public.portraits ({cols}) values\n")
        f.write(",\n".join("(" + ", ".join(q(r[c.strip()]) for c in cols.split(",")) + ")" for r in rows[i:i + 100]))
        f.write("\non conflict (qid) do update set name = excluded.name, aliases = excluded.aliases, sparte = excluded.sparte,\n"
                "  description = excluded.description, image = excluded.image, photo_year = excluded.photo_year, artist = excluded.artist,\n"
                "  license = excluded.license, source_url = excluded.source_url, wiki_title = excluded.wiki_title, level = excluded.level;\n\n")
    cc = "qid, name, sub, sex, born, sparte, fame, as_option, search"
    items = list(cat.values())
    for i in range(0, len(items), 500):
        f.write(f"insert into public.person_names ({cc}) values\n")
        f.write(",\n".join("(" + ", ".join(q(r[c.strip()]) for c in cc.split(",")) + ")" for r in items[i:i + 500]))
        f.write("\non conflict (qid) do update set name = excluded.name, sub = excluded.sub, sex = excluded.sex, born = excluded.born,\n"
                "  sparte = excluded.sparte, fame = excluded.fame, as_option = excluded.as_option, search = excluded.search;\n\n")

from collections import Counter
print("Porträts:", len(rows), Counter(r["sex"] for r in rows), "Easy:", sum(r["level"] == 1 for r in rows))
print("Sparten:", Counter(r["sparte"] for r in rows))
print("Katalog:", len(cat), "als Antwort:", sum(c["as_option"] for c in cat.values()))
print("Migration:", mig, round(os.path.getsize(mig) / 1e6, 2), "MB")
print("Bilder:", round(sum(os.path.getsize(os.path.join(out_dir, f)) for f in os.listdir(out_dir)) / 1e6, 1), "MB")
