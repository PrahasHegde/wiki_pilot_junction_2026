"""Health check: is everything WikiPilot needs in place?

    python scripts/check.py            # database, data, S3 tier, Gemini, frontend
    python scripts/check.py --app      # also call the running app's API (python main.py)

Exit code 0 when every required check passes.
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

OK, WARN, FAIL = "\033[32m✔\033[0m", "\033[33m!\033[0m", "\033[31m✘\033[0m"
failed = []


def check(name, fn, required=True):
    t = time.perf_counter()
    try:
        detail = fn()
        print(f" {OK} {name:<34} {detail}  ({(time.perf_counter() - t) * 1000:.0f} ms)")
    except Exception as e:
        print(f" {FAIL if required else WARN} {name:<34} {type(e).__name__}: {str(e)[:160]}")
        if required:
            failed.append(name)


def need(cond, msg):
    if not cond:
        raise AssertionError(msg)


print("\nWikiPilot health check\n")
from wikipilot import config, db

# ---------------------------------------------------------------- configuration
check(".env: Gemini key", lambda: need(config.GEMINI_API_KEY, "set GEMINI_API_KEY in .env") or "present")
check(".env: S3 keys", lambda: need(os.environ.get("ACCESS_KEY") and os.environ.get("SECRET_KEY"),
                                    "access_key / secret_key missing (needed only to rebuild the S3 archive)") or "present",
      required=False)

# ---------------------------------------------------------------- database + data
check("MariaDB reachable", lambda: db.one("SELECT VERSION() v")["v"])
check("vector + system versioning support",
      lambda: need(db.one("SELECT VERSION() v")["v"] >= "11.7", "MariaDB 11.7+ needed for VECTOR") or "VECTOR + SVT")
check("history (system-versioned `article`)",
      lambda: f"{db.one('SELECT COUNT(*) n FROM article FOR SYSTEM_TIME ALL')['n']:,} versions")
check("articles (`page`)", lambda: f"{db.one('SELECT COUNT(*) n FROM page')['n']:,} articles")
check("passages through time (`passage`)",
      lambda: f"{db.one('SELECT COUNT(*) n FROM passage_done')['n']:,} articles, "
              f"{db.one('SELECT COUNT(*) n FROM passage')['n']:,} current passages")
check("embedding model recorded (`meta`)",
      lambda: need((r := db.one("SELECT v FROM meta WHERE k='embed_model'")), "run scripts/build_passages.py") or r["v"])
check("edit-war analytics (`version_stat`)",
      lambda: need((n := db.one("SELECT COUNT(*) n FROM version_stat")["n"]) > 0, "run scripts/analyze.py") or f"{n:,} rows")
check("today in fi/sv/en (`article_now`)",
      lambda: need((n := db.one("SELECT COUNT(*) n FROM article_now")["n"]) > 0, "run scripts/load_s.py") or f"{n:,} articles")
def s3_tier():
    on = db.one("SELECT COUNT(*) n FROM information_schema.engines WHERE engine = 'S3' AND support = 'YES'")["n"]
    need(on, "S3 engine plugin not loaded (docker compose up -d --build)")
    mapped = db.one("SELECT COUNT(*) n FROM archive_map")["n"]
    return f"engine on, {mapped} archive tables mapped"


def vector_as_of():
    probe = "[" + ",".join(["0"] * 767 + ["1"]) + "]"
    hits = db.rows("SELECT page_id FROM passage FOR SYSTEM_TIME AS OF TIMESTAMP ? "
                   "ORDER BY VEC_DISTANCE_COSINE(embedding, VEC_FromText(?)) LIMIT 3", ("2010-01-01 00:00:00", probe))
    need(hits, "no passages alive in 2010")
    return f"{len(hits)} hits as of 2010"


check("S3 cold tier (`ENGINE=S3`)", s3_tier, required=False)
check("time-travel vector search", vector_as_of)

# ---------------------------------------------------------------- Gemini
def gemini_check():
    from wikipilot import gemini
    v = gemini.embed_query("Talvisota")
    return f"{config.GEMINI_EMBED_MODEL} OK ({len(v)}-d)"


check("Gemini API", gemini_check)

# ---------------------------------------------------------------- frontend
dist = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist", "index.html")
check("frontend built (frontend/dist)", lambda: need(os.path.exists(dist), "cd frontend && npm install && npm run build") or "yes")

# ---------------------------------------------------------------- running app (optional)
if "--app" in sys.argv:
    import requests
    base = f"http://127.0.0.1:{os.environ.get('PORT', 8765)}"   # 127.0.0.1: avoids a slow IPv6 lookup on Windows
    for path in ["/", "/api/stats", "/api/pages?q=talvi", "/api/page/1256", "/api/article/1256?at=2010-01-01",
                 "/api/timeline/1256", "/api/diff/1256?a=2010-01-01&b=2026-10-01", "/api/ages/1256?at=2026-10-01",
                 "/api/activity", "/api/radar", "/api/home"]:
        def call(path=path):
            r = requests.get(base + path, timeout=120)
            need(r.status_code == 200, f"HTTP {r.status_code}")
            need(not (r.headers.get("content-type", "").startswith("application/json") and isinstance(r.json(), dict)
                      and r.json().get("error")), r.text[:120])
            return f"{len(r.content):,} bytes"
        check(f"app {path[:30]}", call)

print()
if failed:
    print(f" {FAIL} {len(failed)} required check(s) failed: {', '.join(failed)}\n")
    sys.exit(1)
print(f" {OK} all required checks passed\n")
