"""Load dataset S: today's articles in Finnish, Swedish and English, the ready-made bge-m3 vectors
(one per article) and the Finnish categories. Used by the language lens and "related articles".

    python scripts/load_s.py
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pyarrow.parquet as pq
from array import array
from wikipilot import db
from wikipilot.config import DATA

con = db.connect(autocommit=False)
cur = con.cursor()
t0 = time.time()
for lang in ("fi", "sv", "en"):
    cur.execute("SELECT COUNT(*) FROM article_now WHERE lang = ?", (lang,))
    if cur.fetchone()[0]:
        print(lang, "already loaded"); continue
    t = pq.read_table(os.path.join(DATA, "s", f"articles-{lang}.parquet"))
    rows = [(r["lang"], r["page_id"], r["rev_id"], r["wikidata_id"], r["title"], r["url"],
             (str(r["date_modified"])[:19].replace("T", " ") if r["date_modified"] else None), r["text"])
            for r in t.to_pylist()]
    for i in range(0, len(rows), 500):
        cur.executemany("INSERT INTO article_now VALUES (?,?,?,?,?,?,?,?)", rows[i:i + 500])
    v = pq.read_table(os.path.join(DATA, "s", f"vectors-bge-m3-{lang}.parquet"), columns=["lang", "page_id", "embedding"])
    vr = [(l, p, array("f", e).tobytes()) for l, p, e in
          zip(v["lang"].to_pylist(), v["page_id"].to_pylist(), v["embedding"].to_pylist())]
    for i in range(0, len(vr), 1000):
        cur.executemany("INSERT INTO article_now_vector VALUES (?,?,?)", vr[i:i + 1000])
    con.commit()
    print(f"{lang}: {len(rows)} articles, {len(vr)} vectors, {time.time()-t0:.0f}s", flush=True)

cur.execute("SELECT COUNT(*) FROM article_category")
if not cur.fetchone()[0]:
    rows = []
    for line in open(os.path.join(DATA, "s", "article-categories-fi.tsv"), encoding="utf-8").read().splitlines()[1:]:
        p, c = line.split("\t")[:2]
        rows.append((int(p), c))
    cur.executemany("INSERT IGNORE INTO article_category VALUES (?,?)", rows)
    con.commit()
    print(f"{len(rows)} categories")
print(f"done in {time.time()-t0:.0f}s")
