"""Materialise version_stat (one row per version, reverts detected) from the system-versioned
`article` table — window functions over FOR SYSTEM_TIME ALL, in page-id ranges.

    python scripts/analyze.py
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from wikipilot import db, radar

con = db.connect(autocommit=False)
cur = con.cursor()
cur.execute("TRUNCATE version_stat")
cur.execute("SELECT MIN(page_id), MAX(page_id) FROM page")
lo, hi = cur.fetchone()
t0, step, n = time.time(), 250_000, 0
for a in range(lo, hi + 1, step):
    cur.execute(radar.MATERIALISE_SQL, (a, a + step - 1))
    n += cur.rowcount
    con.commit()
print(f"version_stat: {n} versions in {time.time() - t0:.0f}s")
