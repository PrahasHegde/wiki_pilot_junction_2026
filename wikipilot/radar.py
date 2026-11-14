"""Edit-war radar across every article: where named editors kept undoing each other, when, and
who. Built on version_stat, materialised from `article` FOR SYSTEM_TIME ALL (scripts/analyze.py)."""
from . import db

# One row per version, with revert detection — window functions over the whole history.
MATERIALISE_SQL = """
INSERT INTO version_stat (page_id, rev_id, ts, user, anonymous, len, delta, is_revert, undid_user, undid_anon)
SELECT page_id, rev_id, row_start, user, anonymous, len,
       CAST(len AS SIGNED) - CAST(COALESCE(LAG(len) OVER w, 0) AS SIGNED),
       COALESCE(sha1 <> LAG(sha1) OVER w AND MIN(row_start) OVER (PARTITION BY page_id, sha1) < row_start, 0),
       LAG(user) OVER w, LAG(anonymous) OVER w
FROM article FOR SYSTEM_TIME ALL
WHERE page_id BETWEEN ? AND ?
WINDOW w AS (PARTITION BY page_id ORDER BY row_start)"""

# "War reverts": a named editor undoing another named editor (not vandalism cleanup).
WAR = "(is_revert AND NOT anonymous AND NOT undid_anon AND user <> undid_user)"

TOP_SQL = f"""
SELECT s.page_id, p.title, COUNT(*) AS edits, SUM(is_revert) AS reverts,
       SUM({WAR}) AS war_reverts,
       SUM(is_revert AND undid_anon) AS vandalism_reverts,
       ROUND(100 * AVG(anonymous)) AS anon_pct,
       COUNT(DISTINCT user) AS editors,
       MIN(ts) AS first_edit, p.deep
FROM version_stat s JOIN page p USING (page_id)
GROUP BY s.page_id
ORDER BY war_reverts DESC
LIMIT ?"""

YEARS_SQL = f"""
SELECT YEAR(ts) AS year, COUNT(*) AS edits, SUM(anonymous) AS anon, SUM(is_revert) AS reverts,
       SUM({WAR}) AS war_reverts, COUNT(DISTINCT user) AS editors, COUNT(DISTINCT page_id) AS pages
FROM version_stat GROUP BY year ORDER BY year"""

# Edit wars: an article-month with at least 3 named-vs-named reverts, and who fought.
WARS_SQL = f"""
SELECT s.page_id, p.title, DATE_FORMAT(ts, '%Y-%m') AS month, COUNT(*) AS war_reverts,
       GROUP_CONCAT(DISTINCT user ORDER BY user SEPARATOR ', ') AS reverters,
       GROUP_CONCAT(DISTINCT undid_user ORDER BY undid_user SEPARATOR ', ') AS reverted
FROM version_stat s JOIN page p USING (page_id)
WHERE {WAR}
GROUP BY s.page_id, month
HAVING war_reverts >= 3
ORDER BY war_reverts DESC
LIMIT ?"""

HEAT_SQL = f"""
SELECT page_id, YEAR(ts) AS year, SUM({WAR}) AS war_reverts, COUNT(*) AS edits
FROM version_stat WHERE page_id IN ({{ids}})
GROUP BY page_id, year"""

TOTALS_SQL = """
SELECT (SELECT COUNT(*) FROM page) AS pages,
       (SELECT SUM(versions) FROM page) AS versions,
       (SELECT COUNT(*) FROM page WHERE deep) AS deep_pages,
       (SELECT COUNT(*) FROM passage FOR SYSTEM_TIME ALL) AS passage_rows,
       (SELECT COUNT(*) FROM passage) AS passages_now,
       (SELECT COUNT(*) FROM passage_done) AS pages_with_passages,
       (SELECT COUNT(*) FROM article_now) AS articles_now,
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND engine = 'S3') AS s3_tables"""


def overview(limit=30):
    tr = db.Trace()
    top = tr.q("most contested articles (named editors undoing each other)", TOP_SQL, (limit,))
    years = tr.q("activity per year, all articles", YEARS_SQL)
    wars = tr.q("edit wars: article-months with ≥3 named reverts", WARS_SQL, (40,))
    heat = []
    if top:
        ids = ",".join(str(int(t["page_id"])) for t in top[:20])
        heat = tr.q("war heat per article per year", HEAT_SQL.format(ids=ids))
    return {"top": top, "years": years, "wars": wars, "heat": heat, "trace": tr.items}


def totals():
    return db.one(TOTALS_SQL)
