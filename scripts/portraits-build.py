"""Bilderrunde, Schritt 1: aus den Kandidaten (probe/kandidaten.json) eine Shortlist
bilden, Beschreibungen und Fotos holen, Gesicht zuschneiden (YuNet) und Text im Bild
erkennen (Tesseract). Ergebnis nach out/ (wird auf den Branch gelegt und dann von Hand gesichtet)."""
import json, os, re, sys, time, io, html, math, subprocess
import urllib.parse, urllib.request, urllib.error

UA = "ObmannsKinderQuiz/0.2 (https://github.com/ThomasAchatz/obmanns-kinder; privates Freundes-Quiz)"
OUT = "out"; os.makedirs(OUT + "/crops", exist_ok=True)

def get(url, data=None, tries=5):
    for t in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404: raise
            wait = int(e.headers.get("Retry-After") or 0) or 8 * (t + 1)
            print("  retry", e.code, "warte", wait, file=sys.stderr); time.sleep(min(wait, 120))
        except Exception as e:
            print("  retry", e, file=sys.stderr); time.sleep(4 * (t + 1))
    raise RuntimeError("fehlgeschlagen: " + url[:140])

def api(base, params):
    return json.loads(get(base + "?" + urllib.parse.urlencode(params)))

people = json.load(open("probe/kandidaten.json"))
people = [p for p in people if p["sex"] in ("w", "m")]
for p in people:
    p["score"] = math.log10((p.get("views") or 0) + 10) + 0.8 * math.log10(max(p["sitelinks"], 1))

# Katalog (Vorschläge im Hard-Mode und falsche Antworten im Easy-Mode)
katalog = sorted([p for p in people if (p.get("views") or 0) >= 2500], key=lambda p: -p["score"])
print("Katalog:", len(katalog))
women = [p for p in katalog if p["sex"] == "w"][:560]
men = [p for p in katalog if p["sex"] == "m"][:280]
short = women + men
print("Shortlist:", len(short), "Frauen", len(women), "Männer", len(men))

# Beschreibungen, Verurteilungen, alle Fotos
def year(v):
    m = re.match(r"[+-](\d{4})", v.get("time", "")) if isinstance(v, dict) else None
    return int(m.group(1)) if m else None
ids = [p["qid"] for p in katalog]
info = {}
for i in range(0, len(ids), 50):
    d = api("https://www.wikidata.org/w/api.php", {"action": "wbgetentities", "format": "json", "props": "descriptions|claims",
            "languages": "de", "ids": "|".join(ids[i:i + 50])})
    for qid, e in d.get("entities", {}).items():
        cl = e.get("claims", {})
        imgs = []
        for c in cl.get("P18", []):
            v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
            if not v: continue
            py = None
            for q in c.get("qualifiers", {}).get("P585", []):
                py = year(q.get("datavalue", {}).get("value"))
            imgs.append({"file": v, "qyear": py, "rank": c.get("rank")})
        info[qid] = {
            "desc": (e.get("descriptions", {}).get("de") or {}).get("value", ""),
            "convicted": bool(cl.get("P1399")),
            "images": imgs,
            "deathcause": [c.get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("id") for c in cl.get("P1196", [])],
        }
    time.sleep(0.2)
    if (i // 50) % 20 == 0: print("  Beschreibungen", i, "/", len(ids))
for p in katalog:
    p.update({k: v for k, v in info.get(p["qid"], {}).items() if k != "images"})
    if info.get(p["qid"], {}).get("images"): p["imgs"] = info[p["qid"]]["images"]

json.dump([{k: p.get(k) for k in ("qid", "name", "dewiki", "aliases", "sex", "born", "died", "sparte", "occ_labels", "views", "sitelinks", "desc", "convicted")}
           for p in katalog], open(OUT + "/katalog.json", "w"), ensure_ascii=False, indent=0)

# Commons: Lizenz, Urheber, Datum für alle Fotos der Shortlist (bis zu 3 je Person)
OK_LIC = re.compile(r"^(cc0|public domain|pd|cc by(-sa)? [\d.]+|cc by(-sa)?$|cc-by(-sa)?-[\d.]+|attribution|gfdl)", re.I)
def strip(s): return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()
titles = []
for p in short:
    for im in (p.get("imgs") or [{"file": f} for f in p["images"]])[:3]:
        titles.append("File:" + im["file"])
files = {}
for i in range(0, len(titles), 40):
    d = api("https://commons.wikimedia.org/w/api.php", {"action": "query", "format": "json", "prop": "imageinfo",
            "iiprop": "url|extmetadata|size|mime", "iiurlwidth": "960", "titles": "|".join(titles[i:i + 40])})
    norm = {n["to"]: n["from"] for n in d["query"].get("normalized", [])}
    for pg in d["query"]["pages"].values():
        ii = (pg.get("imageinfo") or [{}])[0]; md = ii.get("extmetadata", {})
        g = lambda k: strip(md.get(k, {}).get("value"))
        files[norm.get(pg["title"], pg["title"])] = {
            "thumb": ii.get("thumburl"), "w": ii.get("width"), "h": ii.get("height"), "mime": ii.get("mime"),
            "license": g("LicenseShortName"), "artist": g("Artist")[:160], "date": g("DateTimeOriginal")[:60],
            "attr_required": g("AttributionRequired"), "page": ii.get("descriptionurl"),
        }
    time.sleep(0.3)
print("Bildinfos:", len(files))

# Gesichtserkennung
import cv2, numpy as np
from PIL import Image
MODEL = "yunet.onnx"
try:
    open(MODEL, "wb").write(get("https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"))
    yunet = cv2.FaceDetectorYN.create(MODEL, "", (320, 320), 0.75, 0.3, 5000)
    print("YuNet geladen")
except Exception as e:
    print("YuNet nicht verfügbar:", e); yunet = None
casc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

def faces_of(img):
    arr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    H, W = arr.shape[:2]
    if yunet is not None:
        yunet.setInputSize((W, H))
        _, f = yunet.detect(arr)
        if f is None: return []
        return [(int(r[0]), int(r[1]), int(r[2]), int(r[3]), float(r[14])) for r in f]
    g = cv2.cvtColor(arr, cv2.COLOR_BGR2GRAY)
    return [(x, y, w, h, 1.0) for (x, y, w, h) in casc.detectMultiScale(g, 1.1, 6, minSize=(40, 40))]

def ocr(img):
    try:
        img.save("/tmp/o.png")
        r = subprocess.run(["tesseract", "/tmp/o.png", "-", "--psm", "11", "-l", "deu+eng"], capture_output=True, text=True, timeout=60)
        return " ".join(w for w in re.findall(r"[A-Za-zÄÖÜäöüß]{3,}", r.stdout))
    except Exception:
        return ""

def pyear(f, im):
    if im.get("qyear"): return im["qyear"]
    m = re.search(r"(19[3-9]\d|20[0-2]\d)", f.get("date") or "")
    return int(m.group(1)) if m else None

out = []
for n, p in enumerate(short):
    cands = (p.get("imgs") or [{"file": f} for f in p["images"]])[:3]
    rec = {k: p.get(k) for k in ("qid", "name", "dewiki", "aliases", "sex", "born", "died", "sparte", "occ_labels", "views", "sitelinks", "desc", "convicted", "deathcause", "score")}
    rec["status"] = "kein Foto"
    best = None
    for im in cands:
        f = files.get("File:" + im["file"]) or {}
        if not f.get("thumb") or not OK_LIC.search(f.get("license") or ""): continue
        if (f.get("mime") or "").endswith("svg+xml"): continue
        y = pyear(f, im)
        try:
            raw = get(f["thumb"]); time.sleep(0.35)
            img = Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception:
            continue
        fs = faces_of(img)
        if not fs: 
            cand = {"im": im, "f": f, "year": y, "img": img, "face": None, "nfaces": 0}
        else:
            big = max(fs, key=lambda r: r[2] * r[3])
            others = sum(1 for r in fs if r is not big and r[2] * r[3] > 0.3 * big[2] * big[3])
            cand = {"im": im, "f": f, "year": y, "img": img, "face": big, "nfaces": 1 + others}
        sc = (cand["face"] is not None) * 4 + (cand["nfaces"] == 1) * 2 + ((y or 2000) >= 1970) * 2 + (cand["face"] is not None and cand["face"][2] > 110)
        cand["sc"] = sc
        if best is None or sc > best["sc"]: best = cand
        if sc >= 9: break
    if best is None:
        out.append(rec); continue
    img, W, H = best["img"], best["img"].size[0], best["img"].size[1]
    rec.update({"file": best["im"]["file"], "license": best["f"]["license"], "artist": best["f"]["artist"], "page": best["f"]["page"],
                "photo_year": best["year"], "nfaces": best["nfaces"], "src_w": W, "src_h": H})
    if best["face"] is None:
        rec["status"] = "kein Gesicht"; out.append(rec); continue
    x, y, w, h, conf = best["face"]
    cw = min(W, int(w / 0.40)); ch = int(cw * 1.25)
    if ch > H: ch = H; cw = int(ch / 1.25)
    cx = x + w / 2; left = int(min(max(cx - cw / 2, 0), W - cw))
    top = int(min(max(y - 0.27 * ch, 0), H - ch))
    crop = img.crop((left, top, left + cw, top + ch)).resize((480, 600), Image.LANCZOS)
    rec["face_px"] = w; rec["conf"] = round(conf, 2); rec["crop_px"] = cw
    text = ocr(crop)
    rec["ocr"] = text[:200]
    parts = [t.lower() for t in re.findall(r"[A-Za-zÄÖÜäöüß]{4,}", p["name"])]
    rec["name_im_bild"] = any(t in text.lower() for t in parts)
    crop.save(f"{OUT}/crops/{p['qid']}.jpg", quality=84, optimize=True)
    rec["status"] = "ok"
    out.append(rec)
    if n % 50 == 0: print("  Fotos", n, "/", len(short)); json.dump(out, open(OUT + "/shortlist.json", "w"), ensure_ascii=False, indent=0)

json.dump(out, open(OUT + "/shortlist.json", "w"), ensure_ascii=False, indent=0)
from collections import Counter
print("Status:", Counter(r["status"] for r in out))
print("Name im Bild:", sum(1 for r in out if r.get("name_im_bild")), "mehrere Gesichter:", sum(1 for r in out if (r.get("nfaces") or 0) > 1))
