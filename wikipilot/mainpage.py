"""The Main Page, Wikipedia-style — every box computed from MariaDB:
"Did you know…" facts, "On this day" in Wikipedia's own history, a featured article, edit wars."""
from datetime import date
from . import db, wikitext
from .radar import WAR

DYK_SQL = {
    "most_edited": "SELECT page_id, title, versions FROM page ORDER BY versions DESC LIMIT 1",
    "oldest": "SELECT page_id, title, first_edit FROM page ORDER BY first_edit LIMIT 1",
    "most_vandalised": """SELECT s.page_id, p.title, SUM(is_revert AND undid_anon) AS n
                          FROM version_stat s JOIN page p USING (page_id)
                          GROUP BY s.page_id ORDER BY n DESC LIMIT 1""",
    "most_editors": """SELECT s.page_id, p.title, COUNT(DISTINCT user) AS n
                       FROM version_stat s JOIN page p USING (page_id)
                       GROUP BY s.page_id ORDER BY n DESC LIMIT 1""",
    # The largest single removal — and whether the very next version undid it.
    "biggest_cut": """WITH c AS (SELECT page_id, ts, user, anonymous, delta FROM version_stat ORDER BY delta LIMIT 1)
                      SELECT c.*, p.title,
                             (SELECT n.is_revert FROM version_stat n WHERE n.page_id = c.page_id AND n.ts > c.ts
                              ORDER BY n.ts LIMIT 1) AS undone
                      FROM c JOIN page p USING (page_id)""",
    # The oldest text still on Wikipedia: the current passage whose period started first. Only an
    # article that existed early can hold it, so the (page_id, row_start) index does the work.
    "oldest_passage": """SELECT page_id, title, section, row_start AS since, LEFT(text, 220) AS text
                         FROM passage
                         WHERE page_id IN (SELECT page_id FROM page WHERE first_edit < '2005-01-01')
                         ORDER BY row_start LIMIT 1""",
    "anon": "SELECT ROUND(100 * AVG(anonymous)) AS pct, COUNT(*) AS n FROM version_stat",
    "night_owl": """SELECT HOUR(ts) AS h, COUNT(*) AS n FROM version_stat GROUP BY h ORDER BY n LIMIT 1""",
}

ON_THIS_DAY_SQL = f"""
WITH d AS (
  SELECT YEAR(ts) AS year, page_id, COUNT(*) AS edits, SUM({WAR}) AS wars,
         ROW_NUMBER() OVER (PARTITION BY YEAR(ts) ORDER BY COUNT(*) DESC) AS rk
  FROM version_stat
  WHERE MONTH(ts) = ? AND DAYOFMONTH(ts) = ?
  GROUP BY YEAR(ts), page_id)
SELECT d.year, d.page_id, p.title, d.edits, d.wars
FROM d JOIN page p USING (page_id)
WHERE rk = 1 AND d.edits >= 3
ORDER BY d.edits DESC LIMIT 6"""

BORN_SQL = """SELECT page_id, title, YEAR(first_edit) AS year FROM page
              WHERE MONTH(first_edit) = ? AND DAYOFMONTH(first_edit) = ?
              ORDER BY versions DESC LIMIT 4"""

FEATURED_POOL_SQL = "SELECT page_id, title, versions, first_edit FROM page WHERE deep ORDER BY versions DESC LIMIT 30"

MONTHS_SQL = """SELECT DATE_FORMAT(ts, '%Y-%m') AS month, COUNT(*) AS edits, SUM(""" + WAR + """) AS war_reverts
                FROM version_stat WHERE page_id = ? GROUP BY month ORDER BY month"""

_cache = {}


def home():
    today = date.today()
    key = today.isoformat()
    if key in _cache:
        return _cache[key]
    tr = db.Trace()
    dyk = {k: (tr.q(f"did you know: {k}", sql) or [None])[0] for k, sql in DYK_SQL.items()}
    otd = tr.q("on this day: busiest article on this date, per year", ON_THIS_DAY_SQL, (today.month, today.day))
    born = tr.q("on this day: articles first written", BORN_SQL, (today.month, today.day))
    pool = tr.q("featured article pool", FEATURED_POOL_SQL)
    featured = None
    if pool:
        f = pool[today.timetuple().tm_yday % len(pool)]
        cur = tr.q("featured: today's text", "SELECT text, rev_id FROM article WHERE page_id = ?", (f["page_id"],))
        lead = [t for k, t in wikitext.clean(cur[0]["text"] if cur else "") if k == "p" and len(t) > 120][:2]
        then = tr.q("featured: its first version (FOR SYSTEM_TIME ALL)",
                    "SELECT text, row_start FROM article FOR SYSTEM_TIME ALL WHERE page_id = ? ORDER BY row_start LIMIT 1",
                    (f["page_id"],))
        first = [t for k, t in wikitext.clean(then[0]["text"] if then else "") if k == "p" and len(t) > 30][:1]
        featured = {**f, "lead": lead, "first_text": first[0] if first else "",
                    "months": tr.q("featured: edits per month", MONTHS_SQL, (f["page_id"],))}
    out = {"dyk": dyk, "on_this_day": otd, "born": born, "featured": featured,
           "date": today.isoformat(), "trace": tr.items}
    _cache.clear()
    _cache[key] = out
    return out


PAGE_STATS_SQL = f"""
SELECT COUNT(*) AS versions, COUNT(DISTINCT user) AS editors, SUM(is_revert) AS reverts,
       SUM({WAR}) AS war_reverts, SUM(is_revert AND undid_anon) AS vandalism_reverts,
       ROUND(100 * AVG(anonymous)) AS anon_pct, MAX(len) AS max_len,
       MIN(ts) AS first_edit, MAX(ts) AS last_edit
FROM version_stat WHERE page_id = ?"""


def page_stats(pid):
    s = db.one(PAGE_STATS_SQL, (pid,)) or {}
    s["passages"] = (db.one("SELECT COUNT(*) AS n FROM passage FOR SYSTEM_TIME ALL WHERE page_id = ?", (pid,)) or {}).get("n")
    s["languages"] = db.rows("""SELECT n.lang, n.title, n.url FROM page p JOIN article_now n ON n.wikidata_id = p.wikidata_id
                                WHERE p.page_id = ? ORDER BY n.lang""", (pid,))
    return s
