"""The time machine: an article as of any moment, its whole life as a timeline, the difference
between two moments, and sentence blame — who wrote this, when, and how often it was fought over.

Text comes from the hot tier (`article`, system-versioned InnoDB) for the deep articles, and from
the cold tier (`rev_archive`, MariaDB S3 tables on IronShard) for every other article."""
import difflib, re, time
from . import db, wikitext

ANON_RE = "^[0-9]{1,3}(\\\\.[0-9]{1,3}){3}$|^[0-9a-fA-F]*:[0-9a-fA-F:]+$|^~[0-9]{4}-"

PAGE_SQL = "SELECT page_id, title, wikidata_id, versions, first_edit, last_edit, deep FROM page WHERE page_id = ?"

AS_OF_SQL = """
SELECT page_id, title, rev_id, user, anonymous, comment, len, text, row_start AS saved, row_end AS replaced
FROM article FOR SYSTEM_TIME AS OF TIMESTAMP ?
WHERE page_id = ?"""

# The versioned table already knows which version was current (and its exact row_start), so the
# S3 archive is read by primary key: one block fetch instead of a scan of the article's history.
ARCHIVE_AT_SQL = """
SELECT rev_id, ts, text FROM {tbl}
WHERE page_id = ? AND ts = ?"""

# Which S3 table holds this page (archive_map, filled by scripts/archive_s3.py). Querying the one
# table matters: a UNION ALL view over all 16 S3 tables streamed them from object storage.
ARCHIVE_MAP_SQL = "SELECT tbl FROM archive_map WHERE ? BETWEEN lo AND hi LIMIT 1"
_archive = {}


def archive_table(pid):
    if pid not in _archive:
        try:
            r = db.one(ARCHIVE_MAP_SQL, (pid,))
        except Exception:
            r = None
        _archive[pid] = r["tbl"] if r else None
    return _archive[pid]

# Every version, oldest first, with revert detection by window functions:
#  - a revert: text (sha1) differs from the version just before it, but equals an earlier one;
#  - undid_anon: the version it undid was saved anonymously (vandalism cleanup, usually).
VERSIONS_SQL = """
SELECT rev_id, row_start AS ts, user, anonymous, comment, len,
       CAST(len AS SIGNED) - CAST(COALESCE(LAG(len) OVER w, 0) AS SIGNED) AS delta,
       sha1 <> LAG(sha1) OVER w AND MIN(row_start) OVER (PARTITION BY sha1) < row_start AS is_revert,
       LAG(user) OVER w AS prev_user,
       LAG(anonymous) OVER w AS prev_anon
FROM article FOR SYSTEM_TIME ALL
WHERE page_id = ?
WINDOW w AS (ORDER BY row_start)
ORDER BY row_start"""

TIMELINE_SQL = """
WITH v AS (
  SELECT row_start AS ts, user, anonymous,
         CAST(len AS SIGNED) - CAST(COALESCE(LAG(len) OVER w, 0) AS SIGNED) AS delta,
         sha1 <> LAG(sha1) OVER w AND MIN(row_start) OVER (PARTITION BY sha1) < row_start AS is_revert,
         LAG(anonymous) OVER w AS prev_anon
  FROM article FOR SYSTEM_TIME ALL
  WHERE page_id = ?
  WINDOW w AS (ORDER BY row_start))
SELECT DATE_FORMAT(ts, '%Y-%m') AS month, COUNT(*) AS edits,
       SUM(anonymous) AS anon,
       SUM(is_revert) AS reverts,
       SUM(is_revert AND NOT prev_anon AND NOT anonymous) AS war_reverts,
       COUNT(DISTINCT user) AS editors,
       SUM(GREATEST(delta, 0)) AS added, SUM(LEAST(delta, 0)) AS removed
FROM v GROUP BY month ORDER BY month"""

BLAME_HOT_SQL = """
WITH v AS (
  SELECT rev_id, row_start AS ts, user, anonymous, comment, LOCATE(?, text) > 0 AS has
  FROM article FOR SYSTEM_TIME ALL
  WHERE page_id = ?),
w AS (SELECT *, COALESCE(LAG(has) OVER (ORDER BY ts), 0) AS had FROM v)
SELECT rev_id, ts, user, anonymous, comment, has
FROM w WHERE has <> had ORDER BY ts"""

BLAME_COLD_SQL = """
WITH v AS (
  SELECT rev_id, ts, user, LOCATE(?, text) > 0 AS has
  FROM {tbl}
  WHERE page_id = ?),
w AS (SELECT *, COALESCE(LAG(has) OVER (ORDER BY ts), 0) AS had FROM v)
SELECT w.rev_id, w.ts, w.user, w.has, a.comment, a.anonymous
FROM w
LEFT JOIN article FOR SYSTEM_TIME ALL AS a ON a.page_id = ? AND a.rev_id = w.rev_id
WHERE w.has <> w.had ORDER BY w.ts"""


def page(pid):
    return db.one(PAGE_SQL, (pid,))


def find(q, limit=12):
    q = (q or "").strip()
    if not q:
        return db.rows("SELECT page_id, title, versions, deep FROM page ORDER BY versions DESC LIMIT ?", (limit,))
    return db.rows("""SELECT page_id, title, versions, deep FROM page
                      WHERE title LIKE ? ORDER BY title = ? DESC, title LIKE ? DESC, versions DESC LIMIT ?""",
                   (f"%{q}%", q, f"{q}%", limit))


def text_at(tr, pid, at):
    at = db.full_ts(at)
    meta = tr.q("article FOR SYSTEM_TIME AS OF", AS_OF_SQL, (at, pid))
    if not meta:
        return None
    m = meta[0]
    if m["text"] is not None:
        m["tier"] = "hot"
    else:
        tbl, cold = archive_table(pid), []
        if tbl:
            try:
                cold = tr.q(f"full text from S3 cold tier ({tbl}, primary-key lookup)",
                            ARCHIVE_AT_SQL.format(tbl=tbl), (pid, m["saved"]))
            except Exception:
                cold = []
        m["text"] = cold[0]["text"] if cold else ""
        m["tier"] = "s3" if cold else "meta"
    m["replaced"] = m["replaced"] if m["replaced"] and m["replaced"].year < 2037 else None
    return m


def view(pid, at):
    tr = db.Trace()
    m = text_at(tr, pid, at)
    if not m:
        return {"error": "The article did not exist yet at that moment.", "trace": tr.items}
    blocks = wikitext.clean(m.pop("text"))
    return {"meta": m, "blocks": blocks, "trace": tr.items}


def timeline(pid):
    tr = db.Trace()
    months = tr.q("edits per month (window functions over FOR SYSTEM_TIME ALL)", TIMELINE_SQL, (pid,))
    vers = tr.q("every version, reverts detected in SQL", VERSIONS_SQL, (pid,))
    # Edit wars: named editors undoing named editors, clustered by month.
    duels = {}
    for v in vers:
        if v["is_revert"] and not v["prev_anon"] and not v["anonymous"] and v["prev_user"] and v["user"] != v["prev_user"]:
            k = tuple(sorted([v["user"] or "?", v["prev_user"] or "?"]))
            duels[k] = duels.get(k, 0) + 1
    top = sorted(duels.items(), key=lambda kv: -kv[1])[:8]
    return {"months": months,
            "versions": [{"rev_id": v["rev_id"], "ts": v["ts"], "user": v["user"], "anon": bool(v["anonymous"]),
                          "comment": (v["comment"] or "")[:160], "len": v["len"], "delta": v["delta"],
                          "revert": bool(v["is_revert"])} for v in vers],
            "duels": [{"a": a, "b": b, "reverts": n} for (a, b), n in top],
            "trace": tr.items}


# ---------------------------------------------------------------------------------------- diff

def _words(a, b):
    sm = difflib.SequenceMatcher(None, a.split(), b.split(), autojunk=False)
    out = []
    aw, bw = a.split(), b.split()
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            out.append(["=", " ".join(aw[i1:i2])])
        else:
            if i2 > i1:
                out.append(["-", " ".join(aw[i1:i2])])
            if j2 > j1:
                out.append(["+", " ".join(bw[j1:j2])])
    return out


def diff(pid, a, b):
    tr = db.Trace()
    A, B = text_at(tr, pid, a), text_at(tr, pid, b)
    if not A or not B:
        return {"error": "The article did not exist at one of those moments.", "trace": tr.items}
    ab, bb = wikitext.clean(A.pop("text")), wikitext.clean(B.pop("text"))
    at, bt = [t for _, t in ab], [t for _, t in bb]
    kinds_a, kinds_b = [k for k, _ in ab], [k for k, _ in bb]
    sm = difflib.SequenceMatcher(None, at, bt, autojunk=False)
    ops, stats = [], {"same": 0, "changed": 0, "removed": 0, "added": 0}
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            stats["same"] += i2 - i1
            ops.append({"op": "same", "n": i2 - i1, "preview": [[kinds_a[i], at[i]] for i in range(i1, i2) if kinds_a[i] == "h"]})
        elif op == "replace":
            pa, pb = list(range(i1, i2)), list(range(j1, j2))
            while pa and pb:
                x, y = pa.pop(0), pb.pop(0)
                if difflib.SequenceMatcher(None, at[x], bt[y]).quick_ratio() > 0.5:
                    stats["changed"] += 1
                    ops.append({"op": "changed", "kind": kinds_b[y], "words": _words(at[x], bt[y])})
                else:
                    stats["removed"] += 1; stats["added"] += 1
                    ops.append({"op": "removed", "kind": kinds_a[x], "text": at[x]})
                    ops.append({"op": "added", "kind": kinds_b[y], "text": bt[y]})
            for x in pa:
                stats["removed"] += 1; ops.append({"op": "removed", "kind": kinds_a[x], "text": at[x]})
            for y in pb:
                stats["added"] += 1; ops.append({"op": "added", "kind": kinds_b[y], "text": bt[y]})
        elif op == "delete":
            for x in range(i1, i2):
                stats["removed"] += 1; ops.append({"op": "removed", "kind": kinds_a[x], "text": at[x]})
        elif op == "insert":
            for y in range(j1, j2):
                stats["added"] += 1; ops.append({"op": "added", "kind": kinds_b[y], "text": bt[y]})
    return {"a": A, "b": B, "ops": ops, "stats": stats, "trace": tr.items}


# --------------------------------------------------------------------------------------- blame

def _needle(sentence, raw):
    """The longest run of the sentence's words that appears verbatim in the raw wikitext
    (links and markup break the cleaned sentence apart in the source)."""
    words = sentence.split()
    for L in range(min(14, len(words)), 2, -1):
        for i in range(0, len(words) - L + 1):
            s = " ".join(words[i:i + L])
            if len(s) >= 18 and s in raw:
                return s
    return None


def blame(pid, sentence, at):
    from . import gemini
    tr = db.Trace()
    at = db.full_ts(at)
    m = tr.q("the version being read (AS OF)", AS_OF_SQL, (at, pid))
    if not m:
        return {"error": "No such version."}
    m = m[0]
    raw, hot = m["text"], m["text"] is not None
    if not hot:
        tbl, c = archive_table(pid), []
        if tbl:
            try:
                c = tr.q(f"its text from the S3 cold tier ({tbl})", ARCHIVE_AT_SQL.format(tbl=tbl), (pid, m["saved"]))
            except Exception:
                c = []
        raw = c[0]["text"] if c else ""
    needle = _needle(re.sub(r"\s+", " ", sentence.strip()), raw or "")
    if not needle:
        return {"error": "Could not locate this sentence in the source text (it is built from templates or markup).",
                "trace": tr.items}
    t = time.perf_counter()
    if hot:
        ev = tr.q("blame: LOCATE in every version (FOR SYSTEM_TIME ALL) + LAG()", BLAME_HOT_SQL, (needle, pid))
    else:
        ev = tr.q(f"blame: LOCATE in every version (S3 cold tier, {archive_table(pid)}) + LAG()",
                  BLAME_COLD_SQL.format(tbl=archive_table(pid)), (needle, pid, pid))
    p = page(pid)
    events = [{"rev_id": e["rev_id"], "ts": e["ts"], "user": e["user"], "anon": bool(e.get("anonymous")),
               "comment": (e.get("comment") or "")[:200], "kind": "added" if e["has"] else "removed"} for e in ev]
    adds = [e for e in events if e["kind"] == "added"]
    removes = [e for e in events if e["kind"] == "removed"]
    out = {"needle": needle, "tier": "hot" if hot else "s3", "versions_scanned": p["versions"] if p else None,
           "ms": round((time.perf_counter() - t) * 1000), "events": events,
           "first": adds[0] if adds else None, "removed_times": len(removes),
           "restored_times": max(0, len(adds) - 1),
           "present_now": bool(events) and events[-1]["kind"] == "added",
           "editors": len({e["user"] for e in events}), "trace": tr.items}
    # One plain-language sentence about this sentence's life.
    if events:
        lines = "\n".join(f"{e['ts']:%Y-%m-%d} {e['kind']} by {e['user']}{' (anonymous)' if e['anon'] else ''}"
                          f"{': ' + e['comment'] if e['comment'] else ''}" for e in events[:40])
        try:
            out["story"] = gemini.fast(
                "Below is the life of one sentence in a Finnish Wikipedia article: each time it was added or "
                "removed, by whom, with the edit summary. In 1–2 plain English sentences, tell its story for a "
                "reader judging how settled this claim is (stable for years? fought over? vandalism cleanup?). "
                f"No preamble.\n\nSentence: {sentence}\n\n{lines}")
        except Exception:
            pass
    return out


# ------------------------------------------------------------------------------------- text age

AGES_SQL = """
SELECT text, row_start AS since
FROM passage FOR SYSTEM_TIME AS OF TIMESTAMP ?
WHERE page_id = ?"""


def ages(pid, at):
    """How long has each paragraph stood unchanged? Each passage's system-time period starts when
    its exact text first appeared, so the passages alive at `at` date every paragraph they contain.
    Paragraphs edited since the last yearly snapshot match no passage: they are the freshest text."""
    tr = db.Trace()
    at = db.full_ts(at)
    m = text_at(tr, pid, at)
    if not m:
        return {"ages": [], "trace": tr.items}
    blocks = wikitext.clean(m["text"])
    ps = tr.q("passages alive at that moment, with their start (FOR SYSTEM_TIME AS OF)", AGES_SQL, (at, pid))
    out = []
    for i, (kind, t) in enumerate(blocks):
        if kind not in ("p", "li"):
            continue
        key = t[:120]
        since = None
        for p in ps:
            if key in p["text"]:
                since = p["since"] if since is None or p["since"] < since else since
        out.append({"i": i, "since": since})
    return {"ages": out, "passages": len(ps), "trace": tr.items}
