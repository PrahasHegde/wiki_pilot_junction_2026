"""WikiPilot — Wikipedia, read through time.   python main.py   ->  http://localhost:8765"""
import json, os
from datetime import date, datetime
from decimal import Decimal

import uvicorn
from fastapi import FastAPI, Body
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from wikipilot import ask, history, lens, radar, db, mainpage

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
app = FastAPI(title="WikiPilot")
app.mount("/static", StaticFiles(directory=WEB), name="static")


@app.middleware("http")
async def no_stale_assets(request, call_next):
    """Browsers revalidate the page and its assets (cheap ETag check) instead of running stale code."""
    resp = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.on_event("startup")
def warm_up():
    """Load the vector indexes into MariaDB's cache before the first question (cold: ~6 s, warm: ~0.1 s)."""
    import threading

    def run():
        try:
            from wikipilot import search
            tr = db.Trace()
            v = [0.0] * 767 + [1.0]
            for at in ("2005-07-01", "2015-07-01", search.NOW):
                search.retrieve(tr, v, ["talvisota"], at=at, k=1)
            db.rows("SELECT page_id FROM article_now_vector ORDER BY VEC_DISTANCE_COSINE(embedding, "
                    "(SELECT embedding FROM article_now_vector LIMIT 1)) LIMIT 1")
            mainpage.home()
            data = radar.overview()
            if data["top"]:
                _radar["data"] = data
            print("warm-up done:", [(i["label"], i["ms"]) for i in tr.items], flush=True)
        except Exception as e:
            print("warm-up skipped:", e, flush=True)
    threading.Thread(target=run, daemon=True).start()


def _default(o):
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, (bytes, bytearray)):
        return None
    raise TypeError(type(o))


def J(data, status=200):
    return JSONResponse(json.loads(json.dumps(data, default=_default)), status_code=status)


@app.get("/")
def index():
    return FileResponse(os.path.join(WEB, "index.html"))


@app.get("/api/stats")
def stats():
    return J(radar.totals())


@app.get("/api/ask")
def ask_stream(q: str, date: str = ""):
    def gen():
        try:
            for event, data in ask.run(q, date or None):
                yield f"event: {event}\ndata: {json.dumps(data, default=_default, ensure_ascii=False)}\n\n"
        except Exception as e:  # surface errors in the UI instead of a dead stream
            yield f"event: error\ndata: {json.dumps(str(e))}\n\n"
        yield "event: done\ndata: {}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/pages")
def pages(q: str = ""):
    return J(history.find(q))


@app.get("/api/page/{pid}")
def page(pid: int):
    p = history.page(pid)
    if not p:
        return J({"error": "not found"}, 404)
    p["stats"] = mainpage.page_stats(pid)
    return J(p)


@app.get("/api/home")
def home():
    return J(mainpage.home())


@app.get("/api/article/{pid}")
def article(pid: int, at: str):
    return J(history.view(pid, at))


@app.get("/api/ages/{pid}")
def ages(pid: int, at: str):
    return J(history.ages(pid, at))


@app.get("/api/timeline/{pid}")
def timeline(pid: int):
    return J(history.timeline(pid))


@app.get("/api/diff/{pid}")
def diff(pid: int, a: str, b: str):
    return J(history.diff(pid, a, b))


@app.post("/api/blame")
def blame(body: dict = Body(...)):
    return J(history.blame(int(body["page_id"]), body["sentence"], body["at"]))


@app.get("/api/lens/{pid}")
def lens_(pid: int):
    return J(lens.compare(pid))


_activity = {}


@app.get("/api/activity")
def activity():
    """Edits and edit-war reverts per month across all articles — the scrubber's strata."""
    if "rows" not in _activity:
        rows = db.rows(f"""SELECT DATE_FORMAT(ts, '%Y-%m') AS month, COUNT(*) AS edits, SUM({radar.WAR}) AS war_reverts
                           FROM version_stat GROUP BY month ORDER BY month""")
        if not rows:   # before scripts/analyze.py has run: straight from the versioned table
            return J(db.rows("""SELECT DATE_FORMAT(row_start, '%Y-%m') AS month, COUNT(*) AS edits, 0 AS war_reverts
                                FROM article FOR SYSTEM_TIME ALL GROUP BY month ORDER BY month"""))
        _activity["rows"] = rows
    return J(_activity["rows"])


_radar = {}


@app.get("/api/radar")
def radar_():
    """version_stat only changes when scripts/analyze.py runs, so the overview is computed once."""
    if "data" not in _radar:
        data = radar.overview()
        if not data["top"]:
            return J(data)
        _radar["data"] = data
    return J(_radar["data"])


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", 8765)))
