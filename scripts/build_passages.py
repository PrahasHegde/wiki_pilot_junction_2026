"""Build the system-versioned `passage` table: every passage that has ever been in an article,
with a vector, living in system time exactly as long as it lived on Wikipedia.

    python scripts/build_passages.py                  # all pages, most-edited first
    python scripts/build_passages.py --limit 50       # just a few, to try it

For each article: a snapshot on 1 January of every year of its life, plus today's version.
Each snapshot is cleaned and cut into passages. A passage that is in snapshots k..m gets one row
with row_start = time of snapshot k's version and row_end = time of snapshot m+1's version (or
no end: still on Wikipedia today). Embeddings are cached by text hash, so a passage that survives
twenty years is embedded once. Resumable via passage_done.
"""
import argparse, os, sys, time
from array import array
from concurrent.futures import ThreadPoolExecutor
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from wikipilot import db, dataset, gemini, wikitext, diskguard

FIRST_YEAR, LAST_YEAR = 2003, 2026


def snapshots(vers):
    """The version current on 1 Jan of each year, then the newest. Deduplicated."""
    out, i = [], 0
    from datetime import datetime
    for y in range(FIRST_YEAR, LAST_YEAR + 1):
        cut = datetime(y, 1, 1)
        while i < len(vers) and vers[i]["timestamp"] < cut:
            i += 1
        if i > 0:
            v = vers[i - 1]
            if not out or out[-1]["rev_id"] != v["rev_id"]:
                out.append(v)
    if not out or out[-1]["rev_id"] != vers[-1]["rev_id"]:
        out.append(vers[-1])
    return out


def work(item):
    """In a worker process: snapshots -> passages."""
    pid, title, snaps = item
    res, cache = [], {}
    for rev_id, ts, sha1, text in snaps:
        if sha1 in cache:                      # identical text (a revert): same passages
            res.append((rev_id, ts, cache[sha1])); continue
        ps = [(wikitext.chash(pid, t), sec, t) for sec, t in wikitext.passages(title, wikitext.clean(text or ""))]
        cache[sha1] = ps
        res.append((rev_id, ts, ps))
    return pid, title, res


def periods(snaps):
    """[(rev_id, ts, passages)] -> {chash: (section, text, first_rev, [(start, end|None), ...])}"""
    info, runs, open_ = {}, {}, {}
    for k, (rev_id, ts, ps) in enumerate(snaps):
        here = set()
        for h, sec, t in ps:
            if h in here:
                continue
            here.add(h)
            if h not in info:
                info[h] = (sec, t, rev_id)
            if h not in open_:
                open_[h] = ts
        for h in list(open_):
            if h not in here:
                runs.setdefault(h, []).append((open_.pop(h), ts))
    for h, start in open_.items():
        runs.setdefault(h, []).append((start, None))
    return {h: info[h] + (runs[h],) for h in info}


def vec_bytes(v):
    return array("f", v).tobytes()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--group", type=int, default=40, help="pages per embedding batch")
    ap.add_argument("--threads", type=int, default=12)
    ap.add_argument("--procs", type=int, default=6, help="worker processes (memory: ~300 MB each)")
    args = ap.parse_args()

    con = db.connect(autocommit=False)
    cur = con.cursor()
    cur.execute("SET system_versioning_insert_history = 1")
    # All passage vectors must come from one model; refuse to mix.
    cur.execute("SELECT v FROM meta WHERE k = 'embed_model'")
    r = cur.fetchone()
    if r and r[0] != gemini.GEMINI_EMBED_MODEL:
        sys.exit(f"passages were embedded with {r[0]}, config says {gemini.GEMINI_EMBED_MODEL}: rebuild or change config")
    cur.execute("INSERT IGNORE INTO meta VALUES ('embed_model', ?)", (gemini.GEMINI_EMBED_MODEL,))
    con.commit()
    cur.execute("SELECT page_id FROM passage_done")
    done = {r[0] for r in cur.fetchall()}
    sizes = dataset.page_sizes()
    order = sorted((p for p in sizes if p not in done), key=lambda p: -sizes[p][1])
    if args.limit:
        order = order[:args.limit]
    print(f"{len(done)} pages done, {len(order)} to build", flush=True)
    # Most-edited first: read the files in two passes so the demo articles are ready early.
    passes = [set(order[:600]), set(order[600:])]

    pool = Pool(args.procs)
    ex = ThreadPoolExecutor(args.threads)
    t0, n_pages, n_rows, n_emb = time.time(), 0, 0, 0

    def items(only):
        for pid, vers in dataset.iter_pages(["page_id", "title", "rev_id", "timestamp", "sha1", "text"], only=only):
            snaps = snapshots(vers)
            yield pid, vers[-1]["title"], [(v["rev_id"], v["timestamp"], v["sha1"], v["text"]) for v in snaps]

    def flush(group):
        nonlocal n_pages, n_rows, n_emb
        diskguard.wait_for_space("passage build")
        # 1. embeddings from Gemini, in parallel
        want = {}
        for pid, title, per in group:
            for h, (sec, t, _, _) in per.items():
                et = wikitext.embed_text(title, sec, t)
                want[wikitext.thash(et)] = et
        # Deduplicated by text hash within the group; no on-disk cache (disk is the scarce resource:
        # a cache would store every vector twice).
        have = {}
        missing = list(want)
        chunks = [missing[i:i + 100] for i in range(0, len(missing), 100)]
        for part, vecs in zip(chunks, ex.map(lambda c: gemini.embed([want[k] for k in c]), chunks)):
            have.update({k: vec_bytes(v) for k, v in zip(part, vecs)})
        n_emb += len(missing)
        # 2. passage rows with their real periods
        for pid, title, per in group:
            hist, curr = [], []
            for h, (sec, t, rev, runs) in per.items():
                e = have[wikitext.thash(wikitext.embed_text(title, sec, t))]
                for start, end in runs:
                    if end is None:
                        curr.append((pid, h, title, sec, rev, t, e, start))
                    else:
                        hist.append((pid, h, title, sec, rev, t, e, start, end))
            if hist:
                cur.executemany("INSERT INTO passage (page_id, chash, title, section, rev_id, text, embedding, "
                                "row_start, row_end) VALUES (?,?,?,?,?,?,?,?,?)", hist)
            if curr:
                cur.executemany("INSERT INTO passage (page_id, chash, title, section, rev_id, text, embedding, "
                                "row_start) VALUES (?,?,?,?,?,?,?,?)", curr)
            cur.execute("INSERT INTO passage_done VALUES (?,?,?)", (pid, len(per), len(hist) + len(curr)))
            n_rows += len(hist) + len(curr)
        con.commit()
        n_pages += len(group)
        el = time.time() - t0
        print(f"{n_pages} pages  {n_rows} passage rows  {n_emb} embedded  {el:.0f}s  "
              f"({n_pages / el * 60:.0f} pages/min)  last: {group[-1][1]}", flush=True)

    for only in passes:
        if not only:
            continue
        group = []
        for pid, title, snaps in pool.imap_unordered(work, items(only), chunksize=4):
            group.append((pid, title, periods(snaps)))
            if len(group) >= args.group:
                flush(group); group = []
        if group:
            flush(group)
    print(f"done in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
