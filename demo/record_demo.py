"""Record the WikiPilot demo video: drives the real app in Chromium, with captions, a visible cursor
and a Gemini-voiced narration. Waits on slow Gemini calls are logged and cut in post (make_video.py).

    python demo/record_demo.py          # needs the app on :8765 (python main.py) and warm-up done
    python demo/make_video.py           # -> demo/WikiPilot_demo.mp4
"""
import json, os, sys, time, wave, requests
from concurrent.futures import ThreadPoolExecutor
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw"); os.makedirs(RAW, exist_ok=True)
BASE = "http://localhost:8765/"
W, H = 1600, 900

# ------------------------------------------------------------------------------------- script
SCENES = [
    ("intro", "WikiPilot", "An AI agent for Wikipedia",
     "Wikipedia is rewritten every day, and every old version is still there. But nobody can ask them. "
     "Meet WikiPilot: an AI agent for Wikipedia that has read every version ever written. Its main page is built "
     "entirely from SQL over the edit history: did you know, on this day, and the edit wars."),
    ("ask", "Ask Wikipedia: then vs now", "Time-travel RAG on MariaDB system-versioned tables",
     "Ask a question about the past. WikiPilot reads the time in your question, searches Wikipedia as it stood in "
     "2008 and as it stands today, and writes a grounded answer that cites the exact versions."),
    ("ask2", "Every claim is cited", "Sources carry their lifespan on Wikipedia",
     "In 2008, the civil war article blamed the prison camp deaths on a calculated punitive mentality. Today that "
     "framing is gone. Hover a citation for a Wikipedia-style preview. Every source shows when it was on Wikipedia."),
    ("hood", "Under the hood", "One SQL statement: vector index + FOR SYSTEM_TIME AS OF + full-text",
     "Under the hood, it is one MariaDB statement: a vector index on a system-versioned table, queried as of any "
     "date, fused with full-text search. Tens of milliseconds."),
    ("voice", "Ask by voice", "Gemini transcribes any language, then traces the drift",
     "You can simply ask out loud, in any language. Gemini transcribes the question, and WikiPilot traces how "
     "Wikipedia's account drifted over two decades, from the Mainila shelling to the officer who staged it."),
    ("machine", "Time machine", "Any article, on any day since 2003",
     "Open any article on any day since 2003, and press play to watch it rewrite itself. The timeline shows every "
     "edit, vandalism in grey, and edit wars in red."),
    ("blame", "Text age and sentence blame", "Who wrote this? One query over every version",
     "Text age shows what is settled and what is fresh. Click any sentence, and WikiPilot checks every saved "
     "version in a single query: who wrote it, when, and every time it was removed or restored."),
    ("translate", "Read the past in your language", "Gemini translates any version, paragraph by paragraph",
     "Finnish Wikipedia's history, in your language. Gemini translates any version, paragraph by paragraph."),
    ("history", "Real edit history", "Wikipedia's own diff, two columns",
     "This is the real history. On the twenty eighth of January twenty fifteen, a vandal added a joke about rifles. "
     "It was reverted fifty eight seconds later."),
    ("studio", "Editor studio", "Gemini checks a paragraph against Wikipedia's neutrality policy",
     "For editors, the studio checks a paragraph against Wikipedia's neutral point of view. It flags the loaded "
     "word, pressured, proposes a neutral one, and shows the change as a diff, ready to copy."),
    ("illustrate", "Illustrate and edit", "Gemini image generation, labelled AI-generated",
     "It can also illustrate a section, and edit the picture in plain words. Every image is clearly labelled as "
     "AI generated."),
    ("radar", "Edit wars", "862,076 versions analysed with window functions",
     "Across eight hundred sixty two thousand versions, window functions find where knowledge is contested. "
     "Edit wars follow the news: here, the 2012 presidential election."),
    ("lens", "Language lens", "Finnish, Swedish and English Wikipedia compared",
     "Finnish, Swedish and English Wikipedia tell the Winter War differently. WikiPilot lines them up, and shows "
     "editors what each version is missing."),
    ("outro", "WikiPilot", "MariaDB SVT + vector search + S3 engine · five Gemini models",
     "System-versioned tables, vector search, and the S3 engine in MariaDB. Five Gemini models. "
     "WikiPilot: Wikipedia, read through time."),
]
VOICE_Q = "How has the story of who started the Winter War changed over the years?"


def tts(text, path):
    if not os.path.exists(path):
        r = requests.post(BASE + "api/tts", json={"text": text, "voice": "Kore"}, timeout=180)
        r.raise_for_status()
        open(path, "wb").write(r.content)
    with wave.open(path) as w:
        return w.getnframes() / w.getframerate()


print("narration: generating with Gemini TTS…", flush=True)
with ThreadPoolExecutor(6) as ex:
    durs = dict(zip([s[0] for s in SCENES],
                    ex.map(lambda s: tts(s[3], os.path.join(RAW, f"narr_{s[0]}.wav")), SCENES)))
voice_wav = os.path.join(RAW, "voice_question.wav")
voice_dur = tts(VOICE_Q, voice_wav)
print({k: round(v, 1) for k, v in durs.items()}, flush=True)

# ------------------------------------------------------------- overlay: captions + visible cursor
OVERLAY = """
(() => {
  if (window.__wpOverlay) return; window.__wpOverlay = true;
  const css = `
  #wp-cap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(20px);z-index:2147483646;opacity:0;
    transition:opacity .45s,transform .45s;pointer-events:none;background:rgba(16,20,24,.86);color:#fff;border-radius:14px;
    padding:14px 26px 15px;box-shadow:0 12px 40px rgba(0,0,0,.35);backdrop-filter:blur(8px);font-family:Inter,system-ui,sans-serif;
    max-width:1100px;text-align:center}
  #wp-cap.on{opacity:1;transform:translateX(-50%) translateY(0)}
  #wp-cap .t{font:600 25px 'Source Serif 4',Georgia,serif;letter-spacing:.01em}
  #wp-cap .s{font:500 15px Inter,system-ui,sans-serif;color:#b9c7ff;margin-top:3px}
  #wp-cur{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-3px 0 0 -3px;pointer-events:none;left:-50px;top:-50px;
    transition:left .04s linear,top .04s linear}
  #wp-cur svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
  .wp-ripple{position:fixed;z-index:2147483645;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;pointer-events:none;
    border:3px solid #3366cc;animation:wpr .6s ease-out forwards}
  @keyframes wpr{to{transform:scale(3.4);opacity:0}}`;
  const add = () => {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const cap = document.createElement('div'); cap.id = 'wp-cap'; cap.innerHTML = '<div class=t></div><div class=s></div>'; document.body.appendChild(cap);
    const cur = document.createElement('div'); cur.id = 'wp-cur';
    cur.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13 19.3 L10 13 L16 13 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cur);
    addEventListener('mousemove', e => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', e => { const r = document.createElement('div'); r.className = 'wp-ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 700); }, true);
  };
  if (document.body) add(); else addEventListener('DOMContentLoaded', add);
  window.__cap = (t, s) => { const c = document.getElementById('wp-cap'); if (!c) return; if (!t) { c.classList.remove('on'); return; }
    c.querySelector('.t').textContent = t; c.querySelector('.s').textContent = s || ''; c.classList.add('on'); };
})();
"""

# ----------------------------------------------------------------------- timeline bookkeeping
log = {"cuts": [], "scenes": [], "size": [W, H]}
T0 = None
cut_total = 0.0


def now():
    return time.time() - T0


def kept():
    return now() - cut_total


def hold(sec):
    time.sleep(sec)


def waiting(fn, keep=1.0, label=""):
    """Run a slow step; everything after the first `keep` seconds is cut from the video."""
    global cut_total
    a = now()
    out = fn()
    b = now()
    if b - a > keep + 0.3:
        log["cuts"].append([round(a + keep, 3), round(b, 3), label])
        cut_total += b - (a + keep)
    return out


scene_start = {}


def save():
    json.dump({**log, "narration": {k: os.path.join(RAW, f"narr_{k}.wav") for k in durs}},
              open(os.path.join(RAW, "timeline.json"), "w"), indent=1, default=str)


def scene(key):
    k, title, sub, _ = next(s for s in SCENES if s[0] == key)
    save()
    scene_start[key] = kept()
    log["scenes"].append({"key": key, "t_raw": round(now(), 3), "dur": durs[key]})
    pg.evaluate("([t, s]) => window.__cap && window.__cap(t, s)", [title, sub])
    print(f"[{kept():6.1f}s] {title}", flush=True)


def finish(key, extra=0.6):
    """Hold until the narration for this scene has finished (in kept time)."""
    end = scene_start[key] + durs[key] + extra
    while kept() < end:
        time.sleep(0.05)


def caption_off():
    pg.evaluate("() => window.__cap && window.__cap('')")


def move_to(loc, steps=22, dx=0.5, dy=0.5):
    loc.scroll_into_view_if_needed()
    bb = loc.bounding_box()
    x, y = bb["x"] + bb["width"] * dx, bb["y"] + bb["height"] * dy
    pg.mouse.move(x, y, steps=steps)
    return x, y


def click(loc, **kw):
    move_to(loc, **kw); hold(0.18)
    pg.mouse.down(); hold(0.06); pg.mouse.up()
    hold(0.25)


def smooth_scroll(dy, steps=25, pause=0.02):
    for _ in range(steps):
        pg.mouse.wheel(0, dy / steps); time.sleep(pause)


# ---------------------------------------------------------------------------------- recording
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
                                f"--use-file-for-fake-audio-capture={voice_wav}", "--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": W, "height": H}, record_video_dir=RAW, record_video_size={"width": W, "height": H},
                        permissions=["microphone"])
    ctx.add_init_script(OVERLAY)
    pg = ctx.new_page()
    T0 = time.time()
    pg.goto(BASE + "?theme=light")
    pg.wait_for_selector(".mp-box .mp-body ul li", timeout=60000)
    hold(1.2)
    pg.mouse.move(W * 0.62, H * 0.42, steps=5)

    # 1. intro
    scene("intro"); hold(4.5)
    smooth_scroll(560, steps=40, pause=0.04); hold(4)
    smooth_scroll(520, steps=40, pause=0.04); hold(3)
    finish("intro", 0.2)
    smooth_scroll(-1100, steps=20, pause=0.02); hold(0.6)

    # 2. ask: then vs now
    scene("ask")
    click(pg.locator(".mp-banner .chip").first)
    waiting(lambda: pg.wait_for_selector(".references li", timeout=180000), keep=1.4, label="ask search")
    hold(2.5)                                                  # streaming visible
    waiting(lambda: pg.wait_for_function("() => !document.querySelector('.streaming') && document.querySelector('.answer p')", timeout=240000),
            keep=0.6, label="ask writing")
    finish("ask", 0.2)

    scene("ask2")
    smooth_scroll(260, steps=20); hold(1.2)
    sup = pg.locator("sup.ref").nth(2)
    move_to(sup, steps=26); hold(3.2)
    pg.mouse.move(W * 0.9, H * 0.3, steps=12)
    refs = pg.locator(".refs-h"); refs.scroll_into_view_if_needed(); hold(0.4)
    smooth_scroll(-120, steps=8); hold(1)
    move_to(pg.locator(".references .life").first, steps=24); hold(2.5)
    finish("ask2", 0.2)

    # 3. under the hood
    scene("hood")
    hood = pg.locator(".hood-h").first
    click(hood); hold(1.0)
    smooth_scroll(380, steps=25); hold(3)
    finish("hood", 0.2)

    # 4. voice → drift
    scene("voice")
    pg.evaluate("scrollTo({top: 0, behavior: 'smooth'})"); hold(1.0)
    mic = pg.locator(".hdr .search .mic")
    click(mic); hold(voice_dur + 0.5)                           # recording: the fake mic plays the question once
    click(mic)
    waiting(lambda: pg.wait_for_url("**#ask/**", timeout=60000), keep=1.0, label="transcribe")
    hold(1.0)
    waiting(lambda: pg.wait_for_selector(".drift-era", timeout=300000), keep=1.2, label="drift")
    hold(1.0); smooth_scroll(320, steps=30, pause=0.04); hold(2.5); smooth_scroll(380, steps=30, pause=0.04)
    finish("voice", 0.2)

    # 5. time machine (via ⌘K)
    scene("machine")
    pg.keyboard.press("Control+k"); hold(0.6)
    pg.keyboard.type("Talvisota", delay=70); hold(1.0)
    pg.keyboard.press("Enter")
    waiting(lambda: pg.wait_for_selector(".reader .s", timeout=60000), keep=0.6, label="open article")
    pg.wait_for_selector(".tl rect", timeout=60000); hold(1.2)
    move_to(pg.locator(".tl"), dx=0.35, dy=0.6); hold(0.8)
    click(pg.locator("button.btn", has_text="Play history")); hold(6.5)
    click(pg.locator("button.btn", has_text="Pause")); hold(0.6)
    finish("machine", 0.2)

    # 6. text age + blame (at 1 Jan 2010)
    scene("blame")
    pg.evaluate("location.hash = 'machine/1256/2010-01-01'")
    waiting(lambda: pg.wait_for_selector(".reader .s", timeout=60000), keep=0.5, label="travel 2010")
    hold(0.8)
    click(pg.locator(".age-bar button.btn", has_text="text age"))
    waiting(lambda: pg.wait_for_selector(".reader p.age0, .reader p.age1, .reader p.age2", timeout=60000), keep=0.5, label="ages")
    hold(2.0)
    sent = pg.locator(".reader p .s").nth(4)
    click(sent)
    waiting(lambda: pg.wait_for_selector(".blame .events li", timeout=120000), keep=1.0, label="blame")
    move_to(pg.locator(".blame .story"), steps=20); hold(3)
    click(pg.locator(".age-bar button.btn", has_text="text age"))   # turn text age off again
    finish("blame", 0.2)

    # 7. translate (pre-warmed for Talvisota 2010)
    scene("translate")
    sel = pg.locator(".age-bar select")
    move_to(sel); hold(0.4)
    sel.select_option("en")
    waiting(lambda: pg.wait_for_selector(".tr-note", timeout=180000), keep=0.6, label="translate")
    hold(1.0); smooth_scroll(260, steps=20, pause=0.04); hold(2.5)
    sel.select_option("")
    finish("translate", 0.2)

    # 8. history: the 2015 vandalism and its diff
    scene("history")
    pg.evaluate("location.hash = 'machine/1256/2015-03-01/history'")
    waiting(lambda: pg.wait_for_selector(".hist li", timeout=60000), keep=0.6, label="history")
    hold(1.2)
    row = pg.locator(".hist li", has_text="Stryn").first
    move_to(row, steps=24); hold(1.4)
    click(row.locator("a", has_text="prev"))
    waiting(lambda: pg.wait_for_selector("table.diff", timeout=60000), keep=0.6, label="diff")
    hold(0.6)
    pg.locator("table.diff td.del del").first.scroll_into_view_if_needed(); smooth_scroll(-160, steps=8)
    move_to(pg.locator("table.diff td.del del").first, steps=24); hold(3)
    finish("history", 0.2)

    # 9. editor studio: NPOV
    scene("studio")
    click(pg.locator(".tb-actions .btn.quiet", has_text="Back to today")); hold(0.4)   # studio on today's version
    click(pg.locator(".nav-main a", has_text="Editor studio"))
    pg.wait_for_selector(".studio-features"); hold(1.4)
    click(pg.locator(".chips .chip", has_text="Talvisota"))
    waiting(lambda: pg.wait_for_selector(".studio-article p.pick", timeout=60000), keep=0.6, label="studio open")
    hold(0.6)
    click(pg.locator(".studio-article p.pick").nth(1), dy=0.3); hold(0.8)
    click(pg.locator(".task", has_text="Neutrality"))
    waiting(lambda: pg.wait_for_selector(".sdiff", timeout=180000), keep=1.4, label="npov")
    hold(0.6)
    pg.locator(".studio-panel").evaluate("e => e.scrollTo({top: 260, behavior: 'smooth'})"); hold(1.2)
    move_to(pg.locator(".issues li").first, steps=20); hold(2.2)
    pg.locator(".studio-panel").evaluate("e => e.scrollTo({top: 520, behavior: 'smooth'})"); hold(1.2)
    move_to(pg.locator(".sdiff ins").first, steps=20); hold(2.4)
    finish("studio", 0.2)

    # 10. illustrate + edit
    scene("illustrate")
    pg.locator(".studio-panel").evaluate("e => e.scrollTo({top: 0, behavior: 'smooth'})"); hold(0.6)
    click(pg.locator(".seg button", has_text="Illustrate")); hold(0.5)
    click(pg.locator(".chip", has_text="Watercolour")); hold(0.3)
    click(pg.locator(".btn.primary", has_text="Generate"))
    waiting(lambda: pg.wait_for_selector(".gen img", timeout=240000), keep=1.4, label="image")
    hold(0.8)
    pg.locator(".studio-panel").evaluate("e => e.scrollTo({top: 9999, behavior: 'smooth'})"); hold(1.6)
    inp = pg.locator(".edit-box input")
    click(inp); pg.keyboard.type("turn it into a snowy night scene with moonlight", delay=35); hold(0.4)
    click(pg.locator(".edit-box .btn.primary"))
    waiting(lambda: pg.wait_for_selector(".thumbs img >> nth=1", timeout=240000), keep=1.2, label="image edit")
    hold(0.6)
    pg.locator(".studio-panel").evaluate("e => e.scrollTo({top: 9999, behavior: 'smooth'})"); hold(2.6)
    finish("illustrate", 0.2)

    # 11. edit wars
    scene("radar")
    click(pg.locator(".nav-main a", has_text="Edit wars"))
    waiting(lambda: pg.wait_for_selector(".heat .c", timeout=120000), keep=0.6, label="radar")
    hold(2.0); smooth_scroll(380, steps=30, pause=0.04); hold(2.5)
    smooth_scroll(520, steps=30, pause=0.04); hold(1.2)
    war = pg.locator(".war", has_text="Pekka Haavisto").first
    move_to(war, steps=24); hold(1.5)
    click(war)
    waiting(lambda: pg.wait_for_selector(".reader .s", timeout=60000), keep=0.6, label="war month")
    hold(2.5)
    finish("radar", 0.2)

    # 12. language lens
    scene("lens")
    click(pg.locator(".nav-main a", has_text="Language lens")); hold(0.6)
    click(pg.locator(".chips .chip", has_text="Talvisota"))
    waiting(lambda: pg.wait_for_selector(".lens-sum", timeout=240000), keep=1.2, label="lens")
    hold(1.5); smooth_scroll(330, steps=30, pause=0.04); hold(2.5); smooth_scroll(400, steps=30, pause=0.04); hold(2)
    finish("lens", 0.2)

    # 13. outro on the main page
    scene("outro")
    click(pg.locator(".nav-main a", has_text="Main page"))
    pg.wait_for_selector(".mp-box"); hold(1.0)
    finish("outro", 1.2)
    caption_off(); hold(0.8)
    log["end"] = round(now(), 3)
    video_path = pg.video.path()
    ctx.close(); b.close()

log["video"] = str(video_path)
log["narration"] = {k: os.path.join(RAW, f"narr_{k}.wav") for k in durs}
json.dump(log, open(os.path.join(RAW, "timeline.json"), "w"), indent=1)
print("raw video:", video_path)
print(f"raw length {log['end']:.0f}s, cut {cut_total:.0f}s -> final ≈ {log['end'] - cut_total:.0f}s")
