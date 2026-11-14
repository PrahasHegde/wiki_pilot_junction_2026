"""Ask Wikipedia — now, as of a date, then-vs-now, or how the answer drifted over the years.

Every answer is grounded in passages retrieved from MariaDB at the right moment in system time,
and every citation links to the exact Wikipedia version (?oldid=) it came from."""
import json, time
from datetime import datetime
from . import db, gemini, search

TODAY = "2026-10-01"          # the history dataset ends here

PLAN_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "mode": {"type": "STRING", "enum": ["now", "asof", "compare", "drift"]},
        "date": {"type": "STRING", "description": "YYYY-MM-DD for asof/compare, else empty"},
        "topic_question": {"type": "STRING", "description": "the question without any time framing"},
        "search_fi": {"type": "STRING", "description": "one full, specific Finnish sentence describing the information sought (names, events, what is asked) — used for semantic search"},
        "keywords_fi": {"type": "ARRAY", "items": {"type": "STRING"},
                        "description": "2-5 distinctive Finnish base-form words (proper names, key nouns; no years or generic words like sota/Suomi) for full-text search"},
        "language": {"type": "STRING", "description": "language the user wrote in, e.g. English"},
    },
    "required": ["mode", "topic_question", "search_fi", "keywords_fi", "language"],
}

PLAN_PROMPT = """You plan searches over the Finnish Wikipedia's edit history (articles about the history of Finland, every version 2003–2026).
Today is {today}. The user may ask about Wikipedia *at a moment in time*.

Decide the mode:
- "now": an ordinary question about the topic.
- "asof": the user wants what Wikipedia said at a specific date/year ("in 2010", "back in 2008", "before 2015"). Give that date (a year alone = 1 July of that year; "before 2015" = 2015-01-01).
- "compare": the user wants what changed between a past date and now ("what did it say in 2012 and what has changed since"). Give the past date.
- "drift": the user asks how the account/answer evolved over time, without one specific date ("how has the article's view of X changed over the years").
If the user explicitly selected a date in the UI, it is given below; use "asof" with it unless they ask for comparison or drift.

UI-selected date: {ui_date}
User question: {q}"""

SYSTEM = """You are WikiPilot, a research assistant that reads Finnish Wikipedia through time.
Rules:
- Answer ONLY from the numbered sources. Every factual sentence ends with citations like [1] or [2][4].
- Sources are Finnish; answer in {language}. Quote short Finnish phrases where wording matters, with a translation.
- If the sources do not contain the answer, say so plainly — do not use outside knowledge.
- Be neutral (NPOV): where sources disagree or describe a debate, present the sides.
- Be concise: a direct answer first, then supporting detail. Markdown allowed; no headings for short answers."""


def plan(question, ui_date=None):
    try:
        p = gemini.fast(PLAN_PROMPT.format(today=TODAY, ui_date=ui_date or "none", q=question),
                        json_schema=PLAN_SCHEMA)
    except Exception:
        p = {"mode": "now", "topic_question": question, "search_fi": question, "keywords_fi": [], "language": "English"}
    if ui_date and p.get("mode") == "now":
        p["mode"], p["date"] = "asof", ui_date
    if p.get("mode") in ("asof", "compare"):
        try:
            datetime.strptime((p.get("date") or "")[:10], "%Y-%m-%d")
        except ValueError:
            p["mode"] = "now"
    return p


def _fmt_sources(sources, start=1, label=None):
    out = []
    for i, s in enumerate(sources, start):
        when = s["version_saved"].strftime("%Y-%m-%d") if s.get("version_saved") else "?"
        tag = f"{label}, " if label else ""
        out.append(f"[{i}] ({tag}article “{s['title']}”, section “{s.get('section') or 'intro'}”, "
                   f"version saved {when})\n{s['text']}")
    return "\n\n".join(out)


def _public(s, n, era=None):
    return {"n": n, "page_id": s["page_id"], "title": s["title"], "section": s.get("section") or "",
            "text": s["text"], "oldid": s.get("oldid"), "era": era,
            "since": s["since"].isoformat() if s.get("since") else None,
            "until": s["until"].isoformat() if s.get("until") else None,
            "version_saved": s["version_saved"].isoformat() if s.get("version_saved") else None,
            "distance": s.get("distance"), "keyword_rank": s.get("kw_rank")}


def run(question, ui_date=None):
    """Generator of (event, data) for the SSE stream."""
    tr = db.Trace()
    t = time.perf_counter()
    p = plan(question, ui_date)
    tr.add(f"plan with {gemini.GEMINI_FAST_MODEL}", (time.perf_counter() - t) * 1000,
           json.dumps(p, ensure_ascii=False))
    yield "plan", p
    qv = search.embed_question(tr, p.get("search_fi") or question)
    kw = p.get("keywords_fi") or []
    lang = p.get("language") or "English"
    mode = p["mode"]

    if mode == "drift":
        yield from _drift(tr, p, qv, kw, lang)
        return

    if mode == "compare":
        then_at, now_at = p["date"], search.NOW
        a = search.retrieve(tr, qv, kw, at=then_at, k=6)
        b = search.retrieve(tr, qv, kw, at=now_at, k=6)
        srcs = [_public(s, i + 1, "then") for i, s in enumerate(a)] + \
               [_public(s, len(a) + i + 1, "now") for i, s in enumerate(b)]
        yield "sources", srcs
        prompt = (f"Question: {p['topic_question']}\n\n"
                  f"Sources [1]–[{len(a)}] are Wikipedia AS IT STOOD ON {then_at}. "
                  f"Sources [{len(a)+1}]–[{len(srcs)}] are Wikipedia TODAY.\n\n"
                  f"{_fmt_sources(a, 1, 'as of ' + then_at)}\n\n{_fmt_sources(b, len(a) + 1, 'today')}\n\n"
                  f"Write three parts with bold labels: **Then ({then_at[:4]})** — what Wikipedia said then; "
                  f"**Now** — what it says today; **What changed** — concrete differences (numbers, names, framing, "
                  f"emphasis, things added or removed), each with citations from both eras. If nothing material "
                  f"changed, say so.")
    else:
        at = p["date"] if mode == "asof" else search.NOW
        a = search.retrieve(tr, qv, kw, at=at, k=8)
        srcs = [_public(s, i + 1, "asof" if mode == "asof" else "now") for i, s in enumerate(a)]
        yield "sources", srcs
        frame = (f"The sources are Wikipedia exactly as it stood on {at[:10]}. Answer as Wikipedia said then "
                 f"(you may note that this is the {at[:4]} view)." if mode == "asof" else
                 "The sources are today's Wikipedia.")
        prompt = f"Question: {p['topic_question']}\n\n{frame}\n\n{_fmt_sources(a)}"

    if not srcs:
        yield "token", "No passages were found for this question at that moment in time."
        yield "trace", tr.items
        return
    t = time.perf_counter()
    for piece in gemini.stream(prompt, SYSTEM.format(language=lang)):
        yield "token", piece
    tr.add(f"answer with {gemini.GEMINI_MODEL} (streamed)", (time.perf_counter() - t) * 1000)
    yield "trace", tr.items


DRIFT_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "eras": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "year": {"type": "STRING"},
            "answer": {"type": "STRING", "description": "1-3 sentences: what Wikipedia said then, with [n] citations"},
            "changed": {"type": "BOOLEAN", "description": "materially different from the previous era"},
            "change": {"type": "STRING", "description": "if changed: what changed, in a short phrase"}},
            "required": ["year", "answer", "changed"]}},
        "summary": {"type": "STRING", "description": "2-4 sentences: how the account evolved and why it matters"},
    },
    "required": ["eras", "summary"],
}


def _drift(tr, p, qv, kw, lang):
    years = [2005, 2008, 2011, 2014, 2017, 2020, 2023]
    moments = [(str(y), f"{y}-07-01") for y in years] + [("now", search.NOW)]
    srcs, blocks, n = [], [], 1
    for label, at in moments:
        got = search.retrieve(tr, qv, kw, at=at, k=4, per_page=2)
        if not got:
            continue
        blocks.append(f"=== {label} ===\n" + _fmt_sources(got, n, label))
        srcs += [_public(s, n + i, label) for i, s in enumerate(got)]
        n += len(got)
    yield "sources", srcs
    if not srcs:
        yield "token", "No passages were found for this question."
        yield "trace", tr.items
        return
    t = time.perf_counter()
    out = gemini.generate(
        f"Question: {p['topic_question']}\n\nBelow are Wikipedia passages retrieved as Wikipedia stood at "
        f"several moments. For each moment that has sources, state what Wikipedia said then, citing [n] only "
        f"from that moment's sources. Mark changed=true when the account materially differs from the previous "
        f"moment (numbers, names, framing, new or removed claims). Write in {lang}.\n\n" + "\n\n".join(blocks),
        system=SYSTEM.format(language=lang), json_schema=DRIFT_SCHEMA)
    tr.add(f"drift timeline with {gemini.GEMINI_MODEL}", (time.perf_counter() - t) * 1000)
    yield "drift", out
    yield "trace", tr.items
