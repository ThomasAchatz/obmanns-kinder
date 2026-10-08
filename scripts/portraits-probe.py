"""Probelauf für die Bilderrunde: sucht bekannte Personen mit freiem Foto auf
Wikidata/Wikimedia Commons, holt Lizenzangaben und schneidet eine Stichprobe als
Porträt (4:5, Gesicht oben mittig) zu. Ergebnis landet in out/ (als Artefakt)."""
import json, os, random, re, sys, time, io, html
import urllib.parse, urllib.request

UA = "ObmannsKinderQuiz/0.1 (https://github.com/ThomasAchatz/obmanns-kinder; privates Freundes-Quiz)"
OUT = "out"
os.makedirs(OUT + "/crops", exist_ok=True)

def get(url, data=None, tries=4):
    for t in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except Exception as e:
            print("  retry", t, e, file=sys.stderr)
            time.sleep(3 * (t + 1))
    raise RuntimeError("fehlgeschlagen: " + url[:120])

def sparql(q):
    body = urllib.parse.urlencode({"query": q, "format": "json"}).encode()
    return json.loads(get("https://query.wikidata.org/sparql", data=body))["results"]["bindings"]

# 1) Menschen mit Foto und vielen Wikipedia-Sprachversionen (Bekanntheit)
ids = {}
for lo, hi in [(35, 50), (50, 70), (70, 100), (100, 1000)]:
    q = f"""SELECT ?p ?sl WHERE {{
      ?p wikibase:sitelinks ?sl . hint:Prior hint:rangeSafe true .
      FILTER(?sl >= {lo} && ?sl < {hi})
      ?p wdt:P31 wd:Q5 ; wdt:P18 [] .
    }}"""
    rows = sparql(q)
    for r in rows:
        ids[r["p"]["value"].rsplit("/", 1)[1]] = int(r["sl"]["value"])
    print(f"sitelinks {lo}-{hi}: {len(rows)}")
print("Personen mit Foto gesamt:", len(ids))

# 2) Details in 50er-Paketen
def year(claims, pid):
    for c in claims.get(pid, []):
        v = c.get("mainsnak", {}).get("datavalue", {}).get("value", {})
        m = re.match(r"[+-](\d{4})", v.get("time", "") if isinstance(v, dict) else "")
        if m: return int(m.group(1))
    return None

def ent_ids(claims, pid):
    out = []
    for c in claims.get(pid, []):
        v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
        if isinstance(v, dict) and "id" in v: out.append(v["id"])
    return out

people, occ_ids = [], set()
keys = list(ids)
for i in range(0, len(keys), 50):
    chunk = keys[i:i + 50]
    url = ("https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels|aliases|claims|sitelinks"
           "&languages=de|en&sitefilter=dewiki&ids=" + "|".join(chunk))
    data = json.loads(get(url))["entities"]
    for qid, e in data.items():
        cl = e.get("claims", {})
        dewiki = e.get("sitelinks", {}).get("dewiki", {}).get("title")
        born, died = year(cl, "P569"), year(cl, "P570")
        sex = ent_ids(cl, "P21")
        imgs = [c["mainsnak"]["datavalue"]["value"] for c in cl.get("P18", []) if "datavalue" in c["mainsnak"]]
        if not dewiki or not born or not imgs: continue
        if born < 1915 or born > 2007: continue
        if died and died < 1975: continue
        occ = ent_ids(cl, "P106"); occ_ids.update(occ)
        lab = e.get("labels", {})
        people.append({
            "qid": qid, "name": (lab.get("de") or lab.get("en") or {}).get("value", dewiki),
            "dewiki": dewiki, "aliases": [a["value"] for a in e.get("aliases", {}).get("de", [])][:8],
            "sex": "w" if "Q6581072" in sex else "m" if "Q6581097" in sex else "x",
            "born": born, "died": died, "sitelinks": ids[qid], "occ": occ, "images": imgs,
        })
    time.sleep(0.3)
print("nach Filter (dewiki, Jahrgang, lebte nach 1975):", len(people))

# 3) Berufe benennen und in Sparten einteilen
occ_label = {}
ol = list(occ_ids)
for i in range(0, len(ol), 50):
    url = "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=de|en&ids=" + "|".join(ol[i:i + 50])
    for qid, e in json.loads(get(url))["entities"].items():
        l = e.get("labels", {})
        occ_label[qid] = (l.get("de") or l.get("en") or {}).get("value", qid)
    time.sleep(0.2)

SPARTEN = [
    ("Musik", r"sänger|musiker|rapper|komponist|dj|songwriter|pianist|gitarrist|dirigent|schlagzeuger|band"),
    ("Film & TV", r"schauspiel|moderator|regisseur|model|komiker|kabarett|entertainer|webvideo|youtuber|influencer|drehbuch|filmproduzent|fernseh"),
    ("Sport", r"spieler|sportler|athlet|rennfahrer|schwimmer|skirenn|boxer|turner|radrennfahrer|läufer|springer|trainer|skisportler|biathlet|eiskunstläufer|golfer|ringer|reiter"),
    ("Politik", r"politiker|staatsmann|monarch|könig|prinz|diplomat|richter|aktivist|jurist"),
    ("Wissenschaft", r"wissenschaftler|physiker|chemiker|biolog|mathematiker|astronaut|informatiker|ingenieur|mediziner|arzt|ökonom|philosoph|astronom|erfinder"),
    ("Literatur", r"schriftsteller|autor|dichter|journalist|lyriker"),
    ("Wirtschaft", r"unternehmer|manager|geschäftsführer|investor|designer|modeschöpfer"),
    ("Kunst", r"maler|bildhauer|künstler|fotograf|architekt"),
    ("Kirche", r"papst|bischof|theolog|geistlich"),
]
for p in people:
    labels = [occ_label.get(o, "") for o in p["occ"]]
    p["occ_labels"] = labels[:6]
    p["sparte"] = "Sonstige"
    joined = " ".join(labels).lower()
    for name, rx in SPARTEN:
        if re.search(rx, joined):
            p["sparte"] = name; break
    del p["occ"]

json.dump(people, open(OUT + "/kandidaten.json", "w"), ensure_ascii=False, indent=1)

# 4) Stichprobe: ca. 60 % Frauen, gemischt nach Sparte, Bekanntheit und Jahrgang
random.seed(7)
def tier(sl): return "sehr bekannt" if sl >= 100 else "bekannt" if sl >= 60 else "mittel"
pool = [p for p in people if p["sex"] in "wm"]
sample, seen = [], set()
by = {}
for p in pool: by.setdefault((p["sex"], p["sparte"], tier(p["sitelinks"])), []).append(p)
for k in by: random.shuffle(by[k])
want_w, want_m = 96, 64
while (sum(1 for s in sample if s["sex"] == "w") < want_w or sum(1 for s in sample if s["sex"] == "m") < want_m) and any(by.values()):
    for k, lst in by.items():
        if not lst: continue
        sx = k[0]
        if sx == "w" and sum(1 for s in sample if s["sex"] == "w") >= want_w: continue
        if sx == "m" and sum(1 for s in sample if s["sex"] == "m") >= want_m: continue
        sample.append(lst.pop())
print("Stichprobe:", len(sample))

# 5) Bildinfos (Lizenz, Urheber, Aufnahmedatum) von Commons
OK_LIC = re.compile(r"^(cc0|public domain|pd|cc by(-sa)? [\d.]+|cc by(-sa)?$|cc-by(-sa)?-[\d.]+|attribution|gfdl|free art)", re.I)
def strip(s): return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()
files = {}
titles = ["File:" + s["images"][0] for s in sample]
for i in range(0, len(titles), 40):
    url = ("https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata|size"
           "&iiurlwidth=900&titles=" + urllib.parse.quote("|".join(titles[i:i + 40])))
    d = json.loads(get(url))
    norm = {n["to"]: n["from"] for n in d["query"].get("normalized", [])}
    for pg in d["query"]["pages"].values():
        ii = (pg.get("imageinfo") or [{}])[0]; md = ii.get("extmetadata", {})
        g = lambda k: strip(md.get(k, {}).get("value"))
        files[norm.get(pg["title"], pg["title"])] = {
            "thumb": ii.get("thumburl"), "w": ii.get("width"), "h": ii.get("height"),
            "license": g("LicenseShortName"), "artist": g("Artist")[:120], "date": g("DateTimeOriginal")[:40],
            "credit": g("Credit")[:120], "page": ii.get("descriptionurl"),
        }
    time.sleep(0.3)

# 6) Herunterladen und Gesicht zuschneiden
import cv2, numpy as np
from PIL import Image
casc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
report = []
for n, s in enumerate(sample):
    f = files.get("File:" + s["images"][0], {})
    s["file"] = {k: f.get(k) for k in ("license", "artist", "date", "credit", "page", "w", "h")}
    m = re.search(r"(19[4-9]\d|20[0-2]\d)", f.get("date") or "")
    s["photo_year"] = int(m.group(1)) if m else None
    s["status"] = "ok"
    if not f.get("thumb"): s["status"] = "kein Bild"; report.append(s); continue
    if not OK_LIC.search(f.get("license") or ""): s["status"] = "Lizenz? " + (f.get("license") or ""); report.append(s); continue
    try:
        raw = get(f["thumb"]); time.sleep(0.4)
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as e:
        s["status"] = "Download"; report.append(s); continue
    arr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2GRAY)
    faces = casc.detectMultiScale(arr, 1.1, 6, minSize=(40, 40))
    W, H = img.size
    if len(faces) == 0:
        s["status"] = "kein Gesicht"; img.thumbnail((640, 800)); img.save(f"{OUT}/crops/{s['qid']}_raw.jpg", quality=80); report.append(s); continue
    x, y, w, h = max(faces, key=lambda r: r[2] * r[3])
    s["faces"] = int(len(faces))
    cw = min(W, int(w / 0.42)); ch = int(cw * 1.25)
    if ch > H: ch = H; cw = int(ch / 1.25)
    cx = x + w / 2; left = int(min(max(cx - cw / 2, 0), W - cw))
    top = int(min(max(y - 0.30 * ch + h * 0.0, 0), H - ch))
    crop = img.crop((left, top, left + cw, top + ch)).resize((640, 800), Image.LANCZOS)
    s["small"] = cw < 400
    crop.save(f"{OUT}/crops/{s['qid']}.jpg", quality=85)
    report.append(s)
    if n % 20 == 0: print("  ", n, "/", len(sample))

json.dump(report, open(OUT + "/stichprobe.json", "w"), ensure_ascii=False, indent=1)
from collections import Counter
print("Status:", Counter(r["status"].split(" ")[0] for r in report))
print("Sparten (alle):", Counter(p["sparte"] for p in people).most_common())
print("Geschlecht (alle):", Counter(p["sex"] for p in people))
