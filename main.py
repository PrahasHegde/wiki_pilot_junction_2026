"""WikiPilot — Wikipedia, read through time.   python main.py   ->  http://localhost:8765"""
import json, os
from datetime import date, datetime
from decimal import Decimal

import uvicorn
from fastapi import FastAPI, Body, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from wikipilot import ask, history, lens, radar, db, mainpage, studio

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "frontend", "dist")          # the React app (npm run build in frontend/)
app = FastAPI(title="WikiPilot")
if os.path.isdir(os.path.join(DIST, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST, "assets")), name="assets")


@app.middleware("http")
async def cache_policy(request, call_next):
    """Pages revalidate (cheap ETag check); Vite's content-hashed assets are cached for good."""
    resp = await call_next(request)
    p = request.url.path
    if p.startswith("/assets/"):
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif p == "/":
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
            for at in ("2026-10-01", "2010-01-01"):          # demo: the translation moment is instant
                studio.translate(1256, at, "en")
            print("warm-up translations done", flush=True)
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


@app.exception_handler(Exception)
async def any_error(request: Request, exc: Exception):
    """Every failure is JSON with an `error` field, which every view already displays."""
    print(f"error on {request.url.path}: {type(exc).__name__}: {exc}", flush=True)
    text = str(exc)
    down = any(k in text for k in ("Can't connect", "Lost connection", "server has gone away", "Connection refused"))
    msg = ("The database is not reachable. Is MariaDB running (docker compose up -d)?" if down
           else f"{type(exc).__name__}: {text[:300]}")
    return JSONResponse({"error": msg}, status_code=503 if down else 500)


@app.get("/")
def index():
    react = os.path.join(DIST, "index.html")
    if os.path.exists(react):
        return FileResponse(react)
    return HTMLResponse("<h1>WikiPilot</h1><p>The frontend is not built yet. Run:</p>"
                        "<pre>cd frontend\nnpm install\nnpm run build</pre><p>then reload this page.</p>", status_code=503)


@app.get("/api/stats")
def stats():
    return J(radar.totals())


@app.get("/api/ask")
def ask_stream(q: str, date: str = "", lang: str = ""):
    def gen():
        try:
            for event, data in ask.run(q, date or None, studio.LANGS.get(lang)):
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


# ---- Gemini studio: voice, translation, editor tools -----------------------------------------

@app.post("/api/voice")
def voice(body: dict = Body(...)):
    """Speech (base64 audio from the browser's MediaRecorder) -> text + language."""
    return J(studio.transcribe(body["audio"], body.get("mime", "audio/webm")))


@app.post("/api/tts")
def tts(body: dict = Body(...)):
    data, mime = studio.speak(body["text"], body.get("voice", "Kore"))
    return Response(content=data, media_type=mime)


@app.get("/api/translate/{pid}")
def translate(pid: int, at: str, lang: str = "en"):
    return J(studio.translate(pid, at, lang))


@app.post("/api/studio/improve")
def improve(body: dict = Body(...)):
    return J(studio.improve(body.get("title", ""), body["text"], body.get("task", "clarity")))


@app.post("/api/studio/prompt")
def image_prompt(body: dict = Body(...)):
    return J({"prompt": studio.image_prompt(body.get("title", ""), body["text"], body.get("style", "watercolour"))})


@app.post("/api/studio/image")
def image(body: dict = Body(...)):
    return J(studio.image(body["prompt"], body.get("image"), body.get("mime", "image/jpeg"), body.get("style")))


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
    from wikipilot.config import GEMINI_API_KEY
    if not GEMINI_API_KEY:
        print("WARNING: no Gemini key in .env (GEMINI_API_KEY=...). Questions, voice, translation and the "
              "editor studio will not work; time machine, blame and edit wars will.", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", 8765)))
