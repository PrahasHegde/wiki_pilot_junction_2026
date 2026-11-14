"""Edit-war analysis: what was fought over in one article in one month, and how each side
portrayed the subject (hero / villain / victim / neutral / mixed; positive / negative / neutral).

SQL finds the reverts between named editors (version_stat, from FOR SYSTEM_TIME ALL), the version
each revert undid and the version it restored. The texts come from the hot table or the S3 cold
tier; a diff isolates the contested wording; Gemini explains the dispute from those diffs only."""
import difflib, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from . import db, gemini, history, wikitext
from .radar import WAR

EVENTS_SQL = f"""
SELECT rev_id, ts, user, undid_user
FROM version_stat
WHERE page_id = ? AND ts >= ? AND ts < ? AND {WAR}
ORDER BY ts LIMIT 40"""

PREV_SQL = "SELECT rev_id, ts, user FROM version_stat WHERE page_id = ? AND ts < ? ORDER BY ts DESC LIMIT 1"
HOT_TEXT_SQL = "SELECT text FROM article FOR SYSTEM_TIME ALL WHERE page_id = ? AND row_start = ?"
NOW_SQL = "SELECT rev_id, row_start AS ts FROM article WHERE page_id = ?"

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "headline": {"type": "STRING", "description": "max 12 words: what the edit war was about"},
        "summary": {"type": "STRING", "description": "2-3 sentences, plain English"},
        "subject": {"type": "STRING", "description": "the person, group or event being portrayed"},
        "dispute_type": {"type": "STRING", "enum": ["framing", "factual", "naming", "inclusion", "vandalism-like", "style"]},
        "sides": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "side": {"type": "STRING", "enum": ["reverted", "reverters"]},
            "wanted": {"type": "STRING", "description": "what this side wanted the article to say, one sentence"},
            "portrayal": {"type": "STRING", "enum": ["hero", "villain", "victim", "neutral", "mixed"],
                          "description": "how this side's version portrays the subject"},
            "sentiment": {"type": "STRING", "enum": ["positive", "negative", "neutral"]},
            "tone_words": {"type": "ARRAY", "items": {"type": "STRING"}, "description": "2-4 English words for the tone"},
            "example_fi": {"type": "STRING", "description": "a short verbatim quote of this side's wording (Finnish)"},
            "example_en": {"type": "STRING", "description": "its English translation"}},
            "required": ["side", "wanted", "portrayal", "sentiment", "tone_words", "example_fi", "example_en"]}},
        "changes": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "before_en": {"type": "STRING", "description": "the reverted (undone) wording, in English"},
            "after_en": {"type": "STRING", "description": "the restored wording, in English"},
            "what_changed": {"type": "STRING"}}, "required": ["before_en", "after_en", "what_changed"]}},
        "outcome": {"type": "STRING", "description": "which side's wording prevailed, using the 'today' evidence"},
        "npov_verdict": {"type": "STRING", "description": "which version is closer to Wikipedia's neutral point of view, and why"},
    },
    "required": ["headline", "summary", "subject", "dispute_type", "sides", "changes", "outcome", "npov_verdict"],
}

_cache = {}


def _text(pid, deep, ts):
    if deep:
        r = db.one(HOT_TEXT_SQL, (pid, ts))
    else:
        tbl = history.archive_table(pid)
        r = db.one(history.ARCHIVE_AT_SQL.format(tbl=tbl), (pid, ts)) if tbl else None
    return (r or {}).get("text") or ""


def _contested(a_text, b_text, limit=6):
    """Paragraph diff between the undone version (a) and the restored version (b).
    Returns snippets: what the reverted side had vs what the reverters restored."""
    A = [t for k, t in wikitext.clean(a_text) if k in ("p", "li", "h", "h3")]
    B = [t for k, t in wikitext.clean(b_text) if k in ("p", "li", "h", "h3")]
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, A, B, autojunk=False).get_opcodes():
        if op == "equal":
            continue
        a, b = " ".join(A[i1:i2]), " ".join(B[j1:j2])
        if op == "replace":                    # keep only the changed words, with a little context
            aw, bw = a.split(), b.split()
            sm = difflib.SequenceMatcher(None, aw, bw, autojunk=False)
            blocks = [(i1_, i2_, j1_, j2_) for o, i1_, i2_, j1_, j2_ in sm.get_opcodes() if o != "equal"]
            if blocks:
                lo_a, hi_a = max(0, blocks[0][0] - 8), min(len(aw), blocks[-1][1] + 8)
                lo_b, hi_b = max(0, blocks[0][2] - 8), min(len(bw), blocks[-1][3] + 8)
                a, b = " ".join(aw[lo_a:hi_a]), " ".join(bw[lo_b:hi_b])
        out.append({"reverted": a[:450], "restored": b[:450]})
        if len(out) >= limit:
            break
    return out


def analyze(pid, month):
    key = (pid, month)
    if key in _cache:
        return {**_cache[key], "cached": True}
    tr = db.Trace()
    p = history.page(pid)
    if not p:
        return {"error": "Unknown article."}
    start = datetime.strptime(month + "-01", "%Y-%m-%d")
    end = datetime(start.year + (start.month == 12), start.month % 12 + 1, 1)
    events = tr.q("reverts between named editors that month (version_stat)", EVENTS_SQL, (pid, start, end))
    if not events:
        return {"error": "No edit war between named editors in that month.", "trace": tr.items}

    t = time.perf_counter()
    prevs = [db.one(PREV_SQL, (pid, e["ts"])) for e in events]          # the version each revert undid
    pairs = [(pv, e) for pv, e in zip(prevs, events) if pv][:10]
    wanted = sorted({x["ts"] for pv, e in pairs for x in (pv, e)})
    with ThreadPoolExecutor(8) as ex:                                  # S3 reads in parallel
        texts = dict(zip(wanted, ex.map(lambda ts: _text(pid, p["deep"], ts), wanted)))
    now = db.one(NOW_SQL, (pid,))
    today = wikitext.plain(_text(pid, p["deep"], now["ts"])) if now else ""
    tr.add(f"read {len(wanted)} versions ({'hot table' if p['deep'] else 'S3 cold tier'}, parallel) + today's text",
           (time.perf_counter() - t) * 1000)

    disputes, seen = [], set()
    for pv, e in pairs:
        for d in _contested(texts[pv["ts"]], texts[e["ts"]]):
            k = (d["reverted"][:120], d["restored"][:120])
            if k in seen or not (d["reverted"] or d["restored"]):
                continue
            seen.add(k)
            d.update({"reverted_by": e["user"], "undone_user": e["undid_user"], "ts": e["ts"], "rev_id": e["rev_id"],
                      "undone_rev": pv["rev_id"],
                      "reverted_today": bool(d["reverted"]) and d["reverted"][:80] in today,
                      "restored_today": bool(d["restored"]) and d["restored"][:80] in today})
            disputes.append(d)
    disputes = disputes[:8]
    if not disputes:
        return {"error": "The reverts that month restored identical text after formatting-only changes.", "trace": tr.items}

    reverted_side = sorted({e["undid_user"] for e in events if e["undid_user"]})
    reverters = sorted({e["user"] for e in events if e["user"]})
    evidence = "\n\n".join(
        f"Dispute {i + 1} ({d['ts']:%d %b %Y}; {d['undone_user']}'s version undone by {d['reverted_by']}):\n"
        f"REVERTED WORDING: {d['reverted'] or '(nothing: they had removed text)'}\n"
        f"RESTORED WORDING: {d['restored'] or '(nothing: the restore removed it)'}\n"
        f"Today on Wikipedia: reverted wording {'PRESENT' if d['reverted_today'] else 'absent'}, "
        f"restored wording {'PRESENT' if d['restored_today'] else 'absent'}"
        for i, d in enumerate(disputes))
    t = time.perf_counter()
    analysis = gemini.generate(
        f"You analyse an edit war on Finnish Wikipedia for readers and editors, neutrally and without taking sides.\n"
        f"Article: “{p['title']}”. Month: {month}. {len(events)} reverts between named editors.\n"
        f"Side 'reverted' = editors whose edits were undone: {', '.join(reverted_side)}.\n"
        f"Side 'reverters' = editors who undid them: {', '.join(reverters)}.\n\n"
        "Using ONLY the contested wording below, explain what the war was about and how each side's version portrays "
        "the subject (hero, villain, victim, neutral or mixed) with its sentiment (positive, negative, neutral). If a "
        "change is only formatting or a typo, say so. Give exactly two entries in 'sides' (reverted, reverters). Quote "
        "Finnish verbatim from the evidence and translate it. Do not invent facts.\n\n" + evidence,
        json_schema=SCHEMA, temperature=0.2)
    tr.add(f"explain the war with {gemini.GEMINI_MODEL}", (time.perf_counter() - t) * 1000)

    res = {"page_id": pid, "title": p["title"], "month": month, "reverts": len(events),
           "reverted_editors": reverted_side, "reverters": reverters, "disputes": disputes,
           "analysis": analysis, "trace": tr.items}
    _cache[key] = res
    return res
