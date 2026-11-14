"""MariaDB connection and small query helpers."""
import json, time, threading
import mariadb
from .config import DB

EF_SEARCH = 120
_local = threading.local()


def connect(autocommit=True):
    con = mariadb.connect(**DB, autocommit=autocommit)
    cur = con.cursor()
    cur.execute("SET time_zone = '+00:00'")            # Wikipedia's times are UTC
    cur.execute(f"SET mhnsw_ef_search = {EF_SEARCH}")
    cur.close()
    return con


def conn():
    """A per-thread connection that reconnects when it went stale."""
    c = getattr(_local, "con", None)
    if c is not None:
        try:
            c.ping()
            return c
        except mariadb.Error:
            pass
    _local.con = connect()
    return _local.con


def rows(sql, params=(), con=None):
    cur = (con or conn()).cursor()
    cur.execute(sql, params)
    if cur.description is None:
        return []
    cols = [d[0] for d in cur.description]
    out = [dict(zip(cols, r)) for r in cur.fetchall()]
    cur.close()
    return out


def one(sql, params=(), con=None):
    r = rows(sql, params, con)
    return r[0] if r else None


class Trace:
    """Collects every SQL statement an API call ran, with its time — shown in the UI."""

    def __init__(self):
        self.items = []

    def q(self, label, sql, params=()):
        t = time.perf_counter()
        r = rows(sql, params)
        self.items.append({"label": label, "sql": _pretty(sql, params),
                           "ms": round((time.perf_counter() - t) * 1000, 1), "rows": len(r)})
        return r

    def add(self, label, ms, note=""):
        self.items.append({"label": label, "sql": note, "ms": round(ms, 1), "rows": None})


def _pretty(sql, params):
    """The statement with parameters inlined for display (vectors shortened)."""
    out, i = [], 0
    for ch in sql:
        if ch == "?" and i < len(params):
            p = params[i]; i += 1
            if isinstance(p, str) and p.startswith("[") and len(p) > 80:
                out.append("VEC'[%s …]'" % p[1:40])
            elif isinstance(p, str):
                out.append("'" + p.replace("'", "''")[:200] + "'")
            else:
                out.append(str(p))
        else:
            out.append(ch)
    return "\n".join(l for l in "".join(out).strip("\n").split("\n"))


def vec(v):
    return json.dumps([round(x, 6) for x in v])


def full_ts(moment):
    """'2015' / '2015-06' / '2015-06-01' / ISO -> 'YYYY-MM-DD HH:MM:SS[.ffffff]' (TIMESTAMP ? needs it).
    Microseconds are kept: two saves in the same second were stored a microsecond apart."""
    m = str(moment).replace("T", " ").replace("Z", "")[:26]
    if len(m) == 4:
        m += "-01-01"
    if len(m) == 7:
        m += "-01"
    if len(m) == 10:
        m += " 00:00:00"
    if len(m) == 16:
        m += ":00"
    return m
