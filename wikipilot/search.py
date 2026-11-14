"""Retrieval against Wikipedia at any moment: hybrid (vector + full-text) search over the
system-versioned `passage` table, fused with reciprocal-rank fusion — in one SQL statement."""
import re, time
from . import db, gemini

NOW = "2038-01-01 00:00:00"   # anything after the data: "current" rows only

# The vector search stands alone in its CTE (ORDER BY distance LIMIT n) — the shape in which
# MariaDB uses the vector index — and FOR SYSTEM_TIME AS OF restricts it to the passages that
# were on Wikipedia at that moment. Full-text runs against the same moment. RRF fuses the two.
HYBRID_SQL = """
WITH vec AS (
  SELECT page_id, chash, VEC_DISTANCE_COSINE(embedding, VEC_FromText(?)) AS distance
  FROM passage FOR SYSTEM_TIME AS OF TIMESTAMP ?
  ORDER BY distance
  LIMIT ?),
vec_ranked AS (
  SELECT page_id, chash, distance, ROW_NUMBER() OVER (ORDER BY distance) AS r FROM vec),
kw AS (
  SELECT page_id, chash, MATCH(title, section, text) AGAINST (? IN BOOLEAN MODE) AS score
  FROM passage FOR SYSTEM_TIME AS OF TIMESTAMP ?
  WHERE MATCH(title, section, text) AGAINST (? IN BOOLEAN MODE)
  ORDER BY score DESC
  LIMIT ?),
kw_ranked AS (
  SELECT page_id, chash, score, ROW_NUMBER() OVER (ORDER BY score DESC) AS r FROM kw),
fused AS (
  SELECT page_id, chash, SUM(rrf) AS rrf, MIN(distance) AS distance, MAX(kw_rank) AS kw_rank
  FROM (SELECT page_id, chash, 1.0 / (60 + r) AS rrf, distance, NULL AS kw_rank FROM vec_ranked
        UNION ALL
        SELECT page_id, chash, 1.0 / (60 + r), NULL, r FROM kw_ranked) AS u
  GROUP BY page_id, chash)
SELECT p.page_id, p.chash, p.title, p.section, p.text, p.rev_id,
       p.row_start AS since, IF(p.row_end > NOW(), NULL, p.row_end) AS until,
       f.rrf, f.distance, f.kw_rank
FROM fused f
JOIN passage FOR SYSTEM_TIME AS OF TIMESTAMP ? AS p USING (page_id, chash)
ORDER BY f.rrf DESC
LIMIT ?"""

VECTOR_SQL = """
SELECT p.page_id, p.chash, p.title, p.section, p.text, p.rev_id,
       p.row_start AS since, IF(p.row_end > NOW(), NULL, p.row_end) AS until, v.distance
FROM (SELECT page_id, chash, VEC_DISTANCE_COSINE(embedding, VEC_FromText(?)) AS distance
      FROM passage FOR SYSTEM_TIME AS OF TIMESTAMP ?
      ORDER BY distance
      LIMIT ?) AS v
JOIN passage FOR SYSTEM_TIME AS OF TIMESTAMP ? AS p USING (page_id, chash)
ORDER BY v.distance"""

# The version of each cited article that was current at that moment — for ?oldid= links.
VERSION_AT_SQL = """
SELECT page_id, rev_id, title, user, row_start AS saved
FROM article FOR SYSTEM_TIME AS OF TIMESTAMP ?
WHERE page_id IN ({ids})"""

_FT_STOP = set("ja tai on oli ovat että sekä kun mutta jos the of and in to a is was what who how why when "
               "mitä kuka miten miksi milloin".split())


def boolean_query(keywords):
    """Finnish is inflected, so each keyword becomes a prefix search: talvisod* matches
    talvisota, talvisodan, talvisodassa ..."""
    terms = []
    for k in keywords:
        for w in re.findall(r"[\wåäöÅÄÖ-]+", k.lower()):
            if len(w) < 3 or w in _FT_STOP or w.isdigit():
                continue
            stem = w[:max(4, int(len(w) * 0.75))] if len(w) > 5 else w
            terms.append(stem + "*")
    return " ".join(dict.fromkeys(terms))[:400]


def retrieve(trace, question_vec, keywords, at=NOW, k=8, per_page=3, pool=60):
    """Top passages at moment `at`. Hybrid when there are keywords, vector-only otherwise."""
    at = db.full_ts(at)
    V = db.vec(question_vec)
    bq = boolean_query(keywords or [])
    if bq:
        res = trace.q(f"hybrid search · as of {at[:10]}", HYBRID_SQL,
                      (V, at, pool, bq, at, bq, pool, at, pool))
    else:
        res = trace.q(f"vector search · as of {at[:10]}", VECTOR_SQL, (V, at, pool, at))
    out, count = [], {}
    for r in res:
        if count.get(r["page_id"], 0) >= per_page:
            continue
        count[r["page_id"]] = count.get(r["page_id"], 0) + 1
        out.append(r)
        if len(out) >= k:
            break
    if out:
        ids = ",".join(str(int(r["page_id"])) for r in out)
        ver = {v["page_id"]: v for v in trace.q("cited versions (article AS OF)", VERSION_AT_SQL.format(ids=ids), (at,))}
        for r in out:
            v = ver.get(r["page_id"])
            r["oldid"] = v["rev_id"] if v else r["rev_id"]
            r["version_saved"] = v["saved"] if v else None
    return out


_model = {}


def passage_model():
    """The model that embedded the passages — questions must use the same one."""
    if "m" not in _model:
        r = db.one("SELECT v FROM meta WHERE k = 'embed_model'")
        _model["m"] = r["v"] if r else gemini.GEMINI_EMBED_MODEL
    return _model["m"]


def embed_question(trace, text):
    t = time.perf_counter()
    m = passage_model()
    v = gemini.embed_query(text, model=m)
    trace.add(f"embed question ({m}, {gemini.EMBED_DIM}-d)", (time.perf_counter() - t) * 1000)
    return v
