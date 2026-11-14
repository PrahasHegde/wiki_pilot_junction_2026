"""Language lens: the same topic in Finnish, Swedish and English Wikipedia, compared.
Same topic = same Wikidata id. Where a language has no article, the closest one by meaning is
found with the dataset's bge-m3 vectors (MariaDB vector index, cross-language)."""
import time
from . import db, gemini

RELATED_SQL = """
SELECT n.lang, n.page_id, n.title, n.url, v.distance
FROM (SELECT lang, page_id, VEC_DISTANCE_COSINE(embedding, ?) AS distance
      FROM article_now_vector
      WHERE lang = ?
      ORDER BY distance LIMIT ?) AS v
JOIN article_now n USING (lang, page_id)
ORDER BY v.distance"""

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "summary": {"type": "STRING", "description": "2-3 sentences: the most important differences between the language versions"},
        "differences": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "topic": {"type": "STRING"},
            "kind": {"type": "STRING", "enum": ["factual", "emphasis", "omission", "framing"]},
            "fi": {"type": "STRING", "description": "what the Finnish article says, or '—' if absent"},
            "sv": {"type": "STRING"},
            "en": {"type": "STRING"},
            "note": {"type": "STRING", "description": "why this matters for a reader or editor"}},
            "required": ["topic", "kind", "fi", "sv", "en", "note"]}},
        "editor_suggestions": {"type": "ARRAY", "items": {"type": "STRING"},
                               "description": "concrete things editors of each language version could add or check"},
    },
    "required": ["summary", "differences", "editor_suggestions"],
}


def related(lang_vec, lang, k=6):
    return db.rows(RELATED_SQL, (lang_vec, lang, k))


def compare(page_id):
    tr = db.Trace()
    fi = tr.q("Finnish article (today)", "SELECT lang, page_id, wikidata_id, title, url, text FROM article_now "
              "WHERE lang='fi' AND page_id=?", (page_id,))
    if not fi:
        return {"error": "This article is not in today's snapshot (dataset S)."}
    fi = fi[0]
    same = tr.q("same topic in other languages (wikidata_id)",
                "SELECT lang, page_id, title, url, text FROM article_now WHERE wikidata_id=? AND lang<>'fi'",
                (fi["wikidata_id"],)) if fi["wikidata_id"] else []
    by = {"fi": fi, **{r["lang"]: r for r in same}}
    vec = db.one("SELECT embedding FROM article_now_vector WHERE lang='fi' AND page_id=?", (page_id,))
    nearest = {}
    if vec:
        for lang in ("sv", "en"):
            nearest[lang] = [{k: r[k] for k in ("page_id", "title", "url", "distance")}
                             for r in tr.q(f"closest {lang} articles by meaning (bge-m3 vector index)",
                                           RELATED_SQL, (vec["embedding"], lang, 5))]
        nearest["fi"] = [{k: r[k] for k in ("page_id", "title", "url", "distance")}
                         for r in tr.q("related Finnish articles (bge-m3 vector index)", RELATED_SQL,
                                       (vec["embedding"], "fi", 7)) if r["page_id"] != page_id][:6]
    versions = {l: {"title": r["title"], "url": r["url"], "chars": len(r["text"])} for l, r in by.items()}
    out = {"versions": versions, "nearest": nearest, "trace": tr.items}
    if len(by) < 2:
        out["analysis"] = None
        return out
    names = {"fi": "Finnish", "sv": "Swedish", "en": "English"}
    docs = "\n\n".join(f"===== {names[l]} Wikipedia: “{r['title']}” =====\n{r['text'][:60000]}" for l, r in by.items())
    t = time.perf_counter()
    out["analysis"] = gemini.generate(
        "Compare these language versions of the same Wikipedia topic. Find what a careful reader or editor "
        "would want to know: facts that differ (numbers, dates, names), claims present in one version but "
        "missing in another, differences in emphasis or framing (e.g. national perspective, NPOV issues). "
        "Write in English; quote short original phrases where wording matters. Use '—' for a language that "
        "does not cover the point. 5-10 differences, most significant first. Languages present: "
        + ", ".join(names[l] for l in by) + ".\n\n" + docs,
        json_schema=SCHEMA)
    tr.add(f"compare with {gemini.GEMINI_MODEL}", (time.perf_counter() - t) * 1000)
    return out
