"""Cold tier: the full text of every version of every article (12.2 GB of wikitext), archived in
MariaDB S3 tables on the IronShard bucket — queryable with ordinary SQL, almost no local disk.

    python scripts/archive_s3.py

For each dataset file: build an Aria table locally (text COMPRESSED), then
ALTER TABLE ... ENGINE=S3 moves it to the bucket and frees the local space. One file at a time,
so local disk never holds more than ~one table. A view, rev_archive, unions them all.

Hot/cold split: `article` (system-versioned, InnoDB) has every version's metadata and the full
text of the most-edited articles; `rev_archive` (S3) has the full text of all of them.
Resumable: tables already on S3 are skipped.
"""
import os, sys, time
from datetime import timedelta
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from wikipilot import db, dataset, diskguard

BATCH = 4_000_000


def main():
    con = db.connect(autocommit=False)
    cur = con.cursor()
    names = []
    for f in dataset.M_FILES:
        n = os.path.basename(f).split("-")[1].split(".")[0]
        tbl = f"rev_archive_{n}"
        names.append(tbl)
        cur.execute("SELECT engine FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?", (tbl,))
        r = cur.fetchone()
        if r and r[0] == "S3":
            print(f"{tbl}: already on S3"); continue
        diskguard.wait_for_space(f"archive {tbl}")
        t0 = time.time()
        cur.execute(f"DROP TABLE IF EXISTS {tbl}")
        cur.execute(f"""CREATE TABLE {tbl} (
            page_id INT UNSIGNED NOT NULL, rev_id INT UNSIGNED NOT NULL, ts DATETIME(6) NOT NULL,
            user VARCHAR(255), sha1 CHAR(31), len INT UNSIGNED, text MEDIUMTEXT COMPRESSED,
            PRIMARY KEY (page_id, ts, rev_id)) ENGINE=Aria TRANSACTIONAL=0 CHARACTER SET utf8mb4""")
        ins = f"INSERT INTO {tbl} VALUES (?,?,?,?,?,?,?)"
        n_rows, raw = 0, 0
        for pid, vers in dataset.iter_pages(["page_id", "rev_id", "timestamp", "user", "sha1", "bytes", "text"], files=[f]):
            batch, size, last = [], 0, None
            for v in vers:
                ts = v["timestamp"]
                if last is not None and ts <= last:
                    ts = last + timedelta(microseconds=1)
                last = ts
                batch.append((pid, v["rev_id"], ts, v["user"], v["sha1"], v["bytes"], v["text"]))
                size += len(v["text"] or "") * 2 + 200
                if size > BATCH:
                    cur.executemany(ins, batch); batch, size = [], 0
            if batch:
                cur.executemany(ins, batch)
            n_rows += len(vers); raw += sum(v["bytes"] or 0 for v in vers)
        con.commit()
        cur.execute(f"SELECT data_length FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?", (tbl,))
        local = cur.fetchone()[0]
        t1 = time.time()
        cur.execute(f"ALTER TABLE {tbl} ENGINE=S3")
        print(f"{tbl}: {n_rows} versions, {raw/1e6:.0f} MB wikitext -> {local/1e6:.0f} MB Aria, "
              f"built {t1-t0:.0f}s, moved to S3 in {time.time()-t1:.0f}s", flush=True)
        record_range(cur, tbl)
        refresh_view(cur)
    refresh_view(cur)


def record_range(cur, tbl):
    """archive_map: which page ids live in which S3 table (the app routes cold reads with it)."""
    cur.execute("CREATE TABLE IF NOT EXISTS archive_map (tbl VARCHAR(32) NOT NULL PRIMARY KEY, "
                "lo INT UNSIGNED NOT NULL, hi INT UNSIGNED NOT NULL, KEY (lo, hi))")
    cur.execute(f"SELECT MIN(page_id), MAX(page_id) FROM {tbl}")
    lo, hi = cur.fetchone()
    cur.execute("REPLACE INTO archive_map VALUES (?, ?, ?)", (tbl, lo, hi))
    cur.connection.commit()
    print(f"archive_map: {tbl} holds pages {lo}..{hi}", flush=True)


def refresh_view(cur):
    """rev_archive = UNION ALL of the archive tables already on S3 (usable while archiving)."""
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() "
                "AND table_name LIKE 'rev\_archive\_%' AND engine = 'S3' ORDER BY table_name")
    on_s3 = [r[0] for r in cur.fetchall()]
    if on_s3:
        cur.execute("CREATE OR REPLACE VIEW rev_archive AS " + " UNION ALL ".join(f"SELECT * FROM {t}" for t in on_s3))
        print("view rev_archive over", len(on_s3), "S3 tables", flush=True)


if __name__ == "__main__":
    if sys.argv[1:] == ["--view"]:
        c = db.connect(); refresh_view(c.cursor())
    elif sys.argv[1:] == ["--map"]:
        c = db.connect(); cu = c.cursor()
        cu.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() "
                   "AND table_name LIKE 'rev\\_archive\\_%' AND engine = 'S3' ORDER BY table_name")
        for (t,) in cu.fetchall():
            record_range(cu, t)
    else:
        main()
