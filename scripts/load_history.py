"""Load every version of every article (dataset M) into the system-versioned `article` table,
with Wikipedia's real edit times.

    python scripts/load_history.py                 # metadata for all, text for the deep set
    python scripts/load_history.py --deep-gb 3     # raw-text budget for the deep set

How: SET system_versioning_insert_history = 1 lets us write row_start and row_end ourselves.
Each version ends when the next one starts; the newest gets only a start, so it stays current.
Resumable: pages already in `page` are skipped.
"""
import argparse, os, sys, time
from datetime import timedelta
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from wikipilot import db, dataset
import pyarrow.parquet as pq
from wikipilot.config import DATA

# Always deep, whatever their size: the articles the demo is built around.
MUST = ["Talvisota", "Jatkosota", "Suomen sisällissota", "Urho Kekkonen", "Carl Gustaf Emil Mannerheim",
        "Lapuanliike", "Suomen itsenäistyminen", "Lapin sota", "Tarja Halonen", "Mauno Koivisto",
        "Martti Ahtisaari", "Sauli Niinistö", "J. K. Paasikivi", "K. J. Ståhlberg", "P. E. Svinhufvud",
        "Risto Ryti", "Suomettuminen", "Kalevala", "Mikael Agricola", "Saamelaiset", "Ahvenanmaa",
        "Suomen tasavallan presidentti", "Koronaviruspandemia Suomessa", "Suomen Nato-jäsenyys",
        "Isoviha", "Suomen sota", "Jääkäriliike", "Suomen suuriruhtinaskunta", "Routavuodet",
        "Heimosodat", "Moskovan rauha", "Pariisin rauhansopimus (1947)", "YYA-sopimus",
        "Suomen Euroopan unionin jäsenyys", "Noottikriisi", "Yöpakkaset", "Karjala"]

ap = argparse.ArgumentParser()
ap.add_argument("--deep-gb", type=float, default=2.6, help="raw wikitext budget for full-text pages")
args = ap.parse_args()

con = db.connect(autocommit=False)
cur = con.cursor()
for stmt in open(os.path.join(dataset.DATA, "..", "schema.sql"), encoding="utf-8").read().split(";\n"):
    if stmt.strip() and not all(l.strip().startswith("--") or not l.strip() for l in stmt.split("\n")):
        cur.execute(stmt)
con.commit()

# --- Choose the deep set: the must-haves, then the most edited, until the budget is spent.
sizes = dataset.page_sizes()
by_title = {v[0]: k for k, v in sizes.items()}
deep, budget = set(), args.deep_gb * 1e9
for t in MUST:
    if t in by_title:
        deep.add(by_title[t]); budget -= sizes[by_title[t]][2]
for pid, (title, n, b) in sorted(sizes.items(), key=lambda kv: -kv[1][1]):
    if pid in deep:
        continue
    if b <= budget and b < 200e6:
        deep.add(pid); budget -= b
    if budget < 30e6:
        break
print(f"{len(sizes)} pages, {len(deep)} deep ({sum(sizes[p][2] for p in deep)/1e9:.2f} GB raw text)")

# wikidata ids from dataset S
wd = {}
s = pq.read_table(os.path.join(DATA, "s", "articles-fi.parquet"), columns=["page_id", "wikidata_id"])
for p, w in zip(s["page_id"].to_pylist(), s["wikidata_id"].to_pylist()):
    wd[p] = w

cur.execute("SELECT page_id FROM page")
done = {r[0] for r in cur.fetchall()}
print(f"{len(done)} already loaded")

cur.execute("SET system_versioning_insert_history = 1")
INS = """INSERT INTO article (page_id, title, rev_id, parent_id, user, anonymous, comment, minor, sha1,
         len, text, row_start, row_end) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"""
INS_CUR = """INSERT INTO article (page_id, title, rev_id, parent_id, user, anonymous, comment, minor,
         sha1, len, text, row_start) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"""
BATCH = 4_000_000

t0, n_pages, n_vers = time.time(), 0, 0
todo = set(sizes) - done
for pid, vers in dataset.iter_pages(dataset.META + ["text"], only=todo, with_text=deep):
    # unique, strictly increasing start times (two saves in the same second happen)
    last = None
    for v in vers:
        ts = v["timestamp"]
        if last is not None and ts <= last:
            ts = last + timedelta(microseconds=1)
        v["start"] = last = ts
    rowsx = []
    for i, v in enumerate(vers):
        base = (pid, v["title"], v["rev_id"], v["parent_id"], v["user"], bool(v["anonymous"]),
                v["comment"], bool(v["minor"]), v["sha1"], v["bytes"], v["text"], v["start"])
        rowsx.append(base + ((vers[i + 1]["start"],) if i + 1 < len(vers) else ()))
    hist, batch, size = rowsx[:-1], [], 0
    for r in hist:
        batch.append(r); size += len(r[10] or "") * 2 + 300
        if size > BATCH:
            cur.executemany(INS, batch); batch, size = [], 0
    if batch:
        cur.executemany(INS, batch)
    cur.execute(INS_CUR, rowsx[-1])
    cur.execute("INSERT INTO page (page_id, title, wikidata_id, versions, first_edit, last_edit, deep) "
                "VALUES (?,?,?,?,?,?,?)", (pid, vers[-1]["title"], wd.get(pid), len(vers),
                                           vers[0]["timestamp"], vers[-1]["timestamp"], pid in deep))
    con.commit()
    n_pages += 1; n_vers += len(vers)
    if n_pages % 500 == 0 or pid in deep:
        el = time.time() - t0
        print(f"{n_pages} pages, {n_vers} versions, {el:.0f}s  last: {vers[-1]['title']}"
              f"{' (deep)' if pid in deep else ''}", flush=True)
print(f"done: {n_pages} pages, {n_vers} versions in {time.time()-t0:.0f}s")
