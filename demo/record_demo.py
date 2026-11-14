"""Record the WikiPilot demo video (v2): drives the real app in Chromium with animated title cards,
chapter captions, a progress bar, a visible cursor and a Gemini-voiced narration. Slow Gemini waits
are cut and camera zooms are applied in post (make_video.py), which also adds the original music.

    python demo/record_demo.py          # needs the app on :8765 (python main.py) and warm-up done
    python demo/make_video.py           # -> demo/WikiPilot_demo.mp4
"""
import json, os, time, wave, requests
from concurrent.futures import ThreadPoolExecutor
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw"); os.makedirs(RAW, exist_ok=True)
NARR = os.path.join(RAW, "narr_v4"); os.makedirs(NARR, exist_ok=True)
BASE = "http://127.0.0.1:8765/"
W, H = 1600, 900
DPR = 1.0                       # Playwright records the viewport at 1x (a larger size only adds grey padding)
VOICE = "Puck"
# No style instruction in the TTS text: the speech model can read an instruction aloud ("Read this
# like an energetic narrator…"). The upbeat tone comes from the voice itself. Clips are checked below.
STYLE = ""

# ------------------------------------------------------------------------------------- script
# (key, caption title, caption subtitle, narration)
SCENES = [
    ("intro", "", "",
     "Every Wikipedia article has been rewritten hundreds of times, and every old version is still saved. "
     "WikiPilot is an AI that has read all of them. Eight hundred sixty two thousand versions."),
    ("home", "The front page", "Surprising facts from 20 years of edits",
     "The front page is full of surprises from that history: what happened on this day, and where editors argued the most."),
    ("ask", "Ask about the past", "Wikipedia then, and Wikipedia now",
     "Ask a question about the past. Here: what did Wikipedia say about the 1918 prison camps in 2008, and what has changed since? "
     "WikiPilot reads both versions for you."),
    ("ask2", "Every claim has a source", "Each sentence links to the exact old version",
     "Every sentence links to its source. In 2008, the article blamed the deaths on deliberate punishment. Today, that wording is gone."),
    ("hood", "How it works", "A database that remembers every version",
     "Behind the scenes, a MariaDB database keeps every old version, so one quick search can see Wikipedia exactly as it was on any date."),
    ("voice", "Ask out loud", "Any language · how the story changed over the years",
     "You can also just ask out loud, in any language. Here it shows how the story of who started the Winter War changed over twenty years."),
    ("machine", "Time machine", "Open any article, on any day since 2003",
     "The time machine opens any article on any day since 2003. Press play, and watch it change over the years."),
    ("blame", "Who wrote this?", "Fresh text glows · click a sentence for its story",
     "Yellow shows fresh text. White text has stayed the same for years. Click any sentence to see who wrote it, and how often people fought over it."),
    ("translate", "In your language", "Read the past in English, or 11 other languages",
     "And you can read it all in your own language."),
    ("history", "A real moment", "A joke added, removed 58 seconds later",
     "Here's a real moment: someone slipped a joke into the Winter War article. It was removed fifty eight seconds later."),
    ("war", "NEW · Edit wars, explained", "What were they fighting about? Who came out the hero, or the villain?",
     "New: edit wars, explained. When editors keep undoing each other, WikiPilot shows what they were fighting about. "
     "In 2008, one side softened a politician's text message scandal. The other side made him the villain. "
     "It shows who won, and which version was fairer."),
    ("studio", "For Wikipedia editors", "Spots loaded wording, suggests a neutral rewrite",
     "For the people who write Wikipedia, the editor studio spots unfair or loaded wording, and suggests a neutral rewrite."),
    ("illustrate", "Pictures on demand", "Draw it, then change it in plain words",
     "It can also draw a picture for an article, and change it when you describe what you want. Always labelled as made by AI."),
    ("lens", "Three languages, three stories", "Finnish · Swedish · English, side by side",
     "Finally, it compares how Finnish, Swedish and English Wikipedia tell the same story."),
    ("outro", "", "",
     "WikiPilot. Wikipedia, read through time. Built with MariaDB and Google Gemini."),
]
CHAPTERS = [s[0] for s in SCENES if s[1]]
VOICE_Q = "How has the story of who started the Winter War changed over the years?"


def tts(text, path, style=True):
    if not os.path.exists(path):
        r = requests.post(BASE + "api/tts", json={"text": (STYLE if style else "") + text, "voice": VOICE}, timeout=240)
        r.raise_for_status()
        open(path, "wb").write(r.content)
    with wave.open(path) as w:
        d = w.getnframes() / w.getframerate()
    rate = len(text.split()) / d
    if rate < 1.5:      # far slower than speech: extra words were spoken (e.g. an instruction read aloud)
        raise SystemExit(f"narration check failed for {os.path.basename(path)}: {rate:.1f} words/s; delete it and retry")
    return d


print("narration: generating with Gemini TTS…", flush=True)
with ThreadPoolExecutor(6) as ex:
    durs = dict(zip([s[0] for s in SCENES], ex.map(lambda s: tts(s[3], os.path.join(NARR, f"{s[0]}.wav")), SCENES)))
voice_wav = os.path.join(RAW, "voice_question.wav")
voice_dur = tts(VOICE_Q, voice_wav, style=False)
print({k: round(v, 1) for k, v in durs.items()}, flush=True)

# ---------------------------------------------- overlay: title cards, captions, progress, cursor
# Everything lives in a container on <html> (not <body>), so it never moves with the page.
OVERLAY = r"""
(() => {
  if (window.__wpOverlay) return; window.__wpOverlay = true;
  const css = `
  #wp-ui{position:fixed;inset:0;pointer-events:none;z-index:2147483640;font-family:Inter,system-ui,sans-serif}
  #wp-cap{position:absolute;left:50%;bottom:30px;transform:translateX(-50%) translateY(24px);opacity:0;transition:opacity .5s,transform .5s cubic-bezier(.2,.8,.2,1);
    background:rgba(13,17,23,.88);color:#fff;border-radius:16px;padding:12px 26px 14px;box-shadow:0 14px 44px rgba(0,0,0,.38);
    backdrop-filter:blur(10px);text-align:center;max-width:1150px;border:1px solid rgba(255,255,255,.08)}
  #wp-cap.on{opacity:1;transform:translateX(-50%) translateY(0)}
  #wp-cap .n{font:700 11px Inter,sans-serif;letter-spacing:.18em;color:#7ea2ff;margin-bottom:2px}
  #wp-cap .t{font:600 26px 'Source Serif 4',Georgia,serif}
  #wp-cap .t.new{background:linear-gradient(90deg,#ffb86b,#ff6b8b);-webkit-background-clip:text;color:transparent}
  #wp-cap .s{font:500 15px Inter,sans-serif;color:#b9c7ff;margin-top:3px}
  #wp-prog{position:absolute;left:0;top:0;height:4px;width:0;background:linear-gradient(90deg,#3366cc,#7ea2ff,#ff8a65);transition:width .8s ease;box-shadow:0 0 12px #7ea2ff}
  #wp-cur{position:absolute;width:22px;height:22px;margin:-3px 0 0 -3px;left:-50px;top:-50px;transition:left .04s linear,top .04s linear;z-index:3}
  #wp-cur svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
  .wp-ripple{position:absolute;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #3366cc;animation:wpr .6s ease-out forwards}
  @keyframes wpr{to{transform:scale(3.4);opacity:0}}
  #wp-card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0;transition:opacity .9s ease;
    background:radial-gradient(900px 500px at 50% 40%,#1d2d5a 0%,#0b0f17 60%,#06080c 100%);color:#fff;text-align:center;z-index:2}
  #wp-card.on{opacity:1}
  #wp-card .glow{position:absolute;width:520px;height:520px;border-radius:50%;background:radial-gradient(#3366cc55,transparent 65%);animation:pulse 4s ease-in-out infinite}
  @keyframes pulse{50%{transform:scale(1.15);opacity:.7}}
  #wp-card svg.logo{width:120px;height:120px;position:relative;animation:pop 1s cubic-bezier(.2,1.4,.4,1) both}
  #wp-card .hand{transform-origin:32px 32px;animation:spin 3s cubic-bezier(.6,0,.4,1) infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes pop{from{transform:scale(.4);opacity:0}}
  #wp-card .name{font:600 92px 'Source Serif 4',Georgia,serif;font-variant:small-caps;letter-spacing:.02em;margin-top:14px;position:relative;
    background:linear-gradient(180deg,#fff,#b9c7ff);-webkit-background-clip:text;color:transparent;animation:rise 1s .25s cubic-bezier(.2,.8,.2,1) both}
  #wp-card .tag{font:italic 28px 'Source Serif 4',Georgia,serif;color:#b9c7ff;margin-top:4px;position:relative;animation:rise 1s .55s both}
  #wp-card .count{font:700 54px Inter,sans-serif;color:#fff;margin-top:34px;position:relative;font-variant-numeric:tabular-nums;animation:rise 1s .8s both}
  #wp-card .count small{display:block;font:500 16px Inter,sans-serif;color:#7ea2ff;letter-spacing:.2em;text-transform:uppercase;margin-top:4px}
  #wp-card .stack{display:flex;gap:12px;margin-top:30px;position:relative;animation:rise 1s 1.1s both}
  #wp-card .stack span{font:600 14px Inter,sans-serif;padding:7px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#dfe6ff}
  #wp-card .url{font:500 16px Inter,sans-serif;color:#7ea2ff;margin-top:22px;position:relative;animation:rise 1s 1.4s both}
  @keyframes rise{from{opacity:0;transform:translateY(22px)}}`;
  const LOGO = `<svg class="logo" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#0b0f17" stroke="#fff" stroke-width="2.6"/>
    <ellipse cx="32" cy="32" rx="12" ry="28" fill="none" stroke="#8a95a8" stroke-width="1.6"/><path d="M4 32h56M9 18h46M9 46h46" stroke="#8a95a8" stroke-width="1.6"/>
    <g class="hand"><path d="M32 32 L32 12" stroke="#7ea2ff" stroke-width="4.5" stroke-linecap="round"/></g><circle cx="32" cy="32" r="3.4" fill="#7ea2ff"/></svg>`;
  const add = () => {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const ui = document.createElement('div'); ui.id = 'wp-ui';
    ui.innerHTML = '<div id="wp-prog"></div><div id="wp-card"></div><div id="wp-cap"><div class=n></div><div class=t></div><div class=s></div></div>' +
      '<div id="wp-cur"><svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13 19.3 L10 13 L16 13 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg></div>';
    document.documentElement.appendChild(ui);
    const cur = ui.querySelector('#wp-cur');
    addEventListener('mousemove', e => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', e => { const r = document.createElement('div'); r.className = 'wp-ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; ui.appendChild(r); setTimeout(() => r.remove(), 700); }, true);
  };
  if (document.head) add(); else addEventListener('DOMContentLoaded', add);
  window.__cap = (n, t, s, isNew) => { const c = document.getElementById('wp-cap'); if (!c) return; if (!t) { c.classList.remove('on'); return; }
    c.querySelector('.n').textContent = n || ''; const tt = c.querySelector('.t'); tt.textContent = t; tt.className = 't' + (isNew ? ' new' : '');
    c.querySelector('.s').textContent = s || ''; c.classList.add('on'); };
  window.__prog = (f) => { const p = document.getElementById('wp-prog'); if (p) p.style.width = (f * 100) + '%'; };
  window.__card = (kind) => {
    const c = document.getElementById('wp-card'); if (!c) return;
    if (!kind) { c.classList.remove('on'); return; }
    if (kind === 'intro') c.innerHTML = '<div class="glow"></div>' + LOGO + '<div class="name">WikiPilot</div><div class="tag">Wikipedia, read through time</div>' +
      '<div class="count"><span id="wp-num">0</span><small>saved versions of Wikipedia · one AI read them all</small></div>';
    else c.innerHTML = '<div class="glow"></div>' + LOGO + '<div class="name">WikiPilot</div><div class="tag">Wikipedia, read through time</div>' +
      '<div class="stack"><span>MariaDB system-versioned tables</span><span>Vector search</span><span>S3 engine</span><span>5 Gemini models</span></div>' +
      '<div class="url">github.com/PrahasHegde/wiki_pilot_junction_2026</div>';
    c.classList.add('on');
    const el = document.getElementById('wp-num');
    if (el) { const t0 = performance.now(), N = 862076; const step = (t) => { const k = Math.min(1, (t - t0 - 800) / 2600), e = k < 0 ? 0 : 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(N * e).toLocaleString('en-US'); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }
  };
})();
"""

# ----------------------------------------------------------------------- timeline bookkeeping
log = {"cuts": [], "scenes": [], "zooms": [], "size": [int(W * DPR), int(H * DPR)], "scale": DPR}
T0 = None
cut_total = 0.0
scene_start = {}


def now(): return time.time() - T0
def kept(): return now() - cut_total
def hold(sec): time.sleep(sec)


def waiting(fn, keep=1.0, label=""):
    """Run a slow step; everything after the first `keep` seconds is cut from the video."""
    global cut_total
    a = now(); out = fn(); b = now()
    if b - a > keep + 0.3:
        log["cuts"].append([round(a + keep, 3), round(b, 3), label])
        cut_total += b - (a + keep)
    return out


def save():
    json.dump({**log, "narration": {k: os.path.join(NARR, f"{k}.wav") for k in durs}},
              open(os.path.join(RAW, "timeline.json"), "w"), indent=1, default=str)


def scene(key):
    k, title, sub, _ = next(s for s in SCENES if s[0] == key)
    save()
    scene_start[key] = kept()
    log["scenes"].append({"key": key, "t_raw": round(now(), 3), "dur": durs[key]})
    if title:
        i = CHAPTERS.index(key) + 1
        pg.evaluate("([n, t, s, x]) => window.__cap && window.__cap(n, t, s, x)",
                    [f"{i:02d} / {len(CHAPTERS):02d}", title, sub, title.startswith("NEW")])
        pg.evaluate("f => window.__prog && window.__prog(f)", i / len(CHAPTERS))
    print(f"[{kept():6.1f}s] {key}", flush=True)


def finish(key, extra=0.4):
    end = scene_start[key] + durs[key] + extra
    while kept() < end:
        time.sleep(0.05)


def zoom(loc, z=1.45, sec=3.0, dy=0.5):
    """Mark a camera push-in on an element (applied in post) and hold while it plays."""
    loc.scroll_into_view_if_needed(); hold(0.2)
    bb = loc.bounding_box()
    cx, cy = bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] * dy
    a = now()
    hold(sec)
    log["zooms"].append({"a": round(a, 3), "b": round(now(), 3), "cx": round(cx, 1), "cy": round(cy, 1), "z": z})


def move_to(loc, steps=20, dx=0.5, dy=0.5):
    loc.scroll_into_view_if_needed()
    bb = loc.bounding_box()
    x, y = bb["x"] + bb["width"] * dx, bb["y"] + bb["height"] * dy
    pg.mouse.move(x, y, steps=steps)
    return x, y


def click(loc, **kw):
    move_to(loc, **kw); hold(0.15)
    pg.mouse.down(); hold(0.05); pg.mouse.up(); hold(0.2)


def smooth_scroll(dy, steps=22, pause=0.02):
    for _ in range(steps):
        pg.mouse.wheel(0, dy / steps); time.sleep(pause)


# ---------------------------------------------------------------------------------- recording
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
                                f"--use-file-for-fake-audio-capture={voice_wav}", "--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=DPR, record_video_dir=RAW,
                        record_video_size={"width": int(W * DPR), "height": int(H * DPR)}, permissions=["microphone"])
    ctx.add_init_script(OVERLAY)
    pg = ctx.new_page()
    T0 = time.time()
    pg.goto(BASE + "?theme=light")
    pg.wait_for_function("() => window.__card && document.getElementById('wp-card')")
    pg.evaluate("() => window.__card('intro')")
    pg.wait_for_selector(".mp-box .mp-body ul li", timeout=60000)

    # 1. intro title card
    scene("intro"); finish("intro", 0.6)
    pg.evaluate("() => window.__card('')"); hold(0.9)
    pg.mouse.move(W * 0.62, H * 0.42, steps=5)

    # 2. main page
    scene("home"); hold(1.2)
    smooth_scroll(560, steps=30, pause=0.03); hold(1.8)
    zoom(pg.locator(".mp-box.green").nth(1), z=1.35, sec=2.6, dy=0.4)
    finish("home", 0.1)
    smooth_scroll(-1100, steps=14, pause=0.02); hold(0.4)

    # 3. ask: then vs now
    scene("ask")
    click(pg.locator(".mp-banner .chip").first)
    waiting(lambda: pg.wait_for_selector(".references li", timeout=180000), keep=1.4, label="ask search")
    hold(2.2)
    waiting(lambda: pg.wait_for_function("() => !document.querySelector('.streaming') && document.querySelector('.answer p')", timeout=240000),
            keep=0.8, label="ask writing")
    finish("ask", 0.1)

    scene("ask2")
    zoom(pg.locator(".answer p").nth(1), z=1.5, sec=3.4, dy=0.5)
    sup = pg.locator("sup.ref").nth(2)
    move_to(sup, steps=22); hold(2.6)
    pg.mouse.move(W * 0.9, H * 0.3, steps=10)
    pg.locator(".refs-h").scroll_into_view_if_needed(); smooth_scroll(-110, steps=6); hold(0.6)
    move_to(pg.locator(".references .life").first, steps=20); hold(1.6)
    finish("ask2", 0.1)

    # 4. under the hood
    scene("hood")
    click(pg.locator(".hood-h").first); hold(0.8)
    smooth_scroll(340, steps=18); hold(0.4)
    zoom(pg.locator(".tq pre").nth(2), z=1.55, sec=3.2, dy=0.35)
    finish("hood", 0.1)

    # 5. voice → drift
    scene("voice")
    pg.evaluate("scrollTo({top: 0, behavior: 'smooth'})"); hold(0.8)
    mic = pg.locator(".hdr .search .mic")
    click(mic); hold(voice_dur + 0.5)
    click(mic)
    waiting(lambda: pg.wait_for_url("**#ask/**", timeout=60000), keep=1.0, label="transcribe")
    hold(0.8)
    waiting(lambda: pg.wait_for_selector(".drift-era", timeout=300000), keep=1.0, label="drift")
    hold(0.6); smooth_scroll(320, steps=24, pause=0.035); hold(1.4); smooth_scroll(360, steps=24, pause=0.035)
    finish("voice", 0.1)

    # 6. time machine (⌘K), play
    scene("machine")
    pg.keyboard.press("Control+k"); hold(0.5)
    pg.keyboard.type("Talvisota", delay=60); hold(0.8)
    pg.keyboard.press("Enter")
    waiting(lambda: pg.wait_for_selector(".reader .s", timeout=60000), keep=0.6, label="open article")
    pg.wait_for_selector(".tl rect", timeout=60000); hold(0.8)
    click(pg.locator("button.btn", has_text="Play history")); hold(5.5)
    click(pg.locator("button.btn", has_text="Pause")); hold(0.3)
    finish("machine", 0.1)

    # 7. text age + blame (1 Jan 2010)
    scene("blame")
    pg.evaluate("location.hash = 'machine/1256/2010-01-01'")
    waiting(lambda: pg.wait_for_selector(".reader .s", timeout=60000), keep=0.5, label="travel 2010")
    hold(0.5)
    click(pg.locator(".age-bar button.btn", has_text="text age"))
    waiting(lambda: pg.wait_for_selector(".reader p.age0, .reader p.age1, .reader p.age2", timeout=60000), keep=0.5, label="ages")
    hold(1.4)
    click(pg.locator(".reader p .s").nth(4))
    waiting(lambda: pg.wait_for_selector(".blame .events li", timeout=120000), keep=1.0, label="blame")
    zoom(pg.locator(".blame .story"), z=1.6, sec=3.4)
    click(pg.locator(".age-bar button.btn", has_text="text age"))
    finish("blame", 0.1)

    # 8. translate
    scene("translate")
    sel = pg.locator(".age-bar select")
    move_to(sel); hold(0.3)
    sel.select_option("en")
    waiting(lambda: pg.wait_for_selector(".tr-note", timeout=180000), keep=0.6, label="translate")
    hold(0.6); smooth_scroll(240, steps=18, pause=0.03); hold(1.4)
    sel.select_option("")
    finish("translate", 0.1)

    # 9. history → the vandalism diff
    scene("history")
    pg.evaluate("location.hash = 'machine/1256/2015-03-01/history'")
    waiting(lambda: pg.wait_for_selector(".hist li", timeout=60000), keep=0.5, label="history")
    hold(0.6)
    row = pg.locator(".hist li", has_text="Stryn").first
    move_to(row, steps=20); hold(0.8)
    click(row.locator("a", has_text="prev"))
    waiting(lambda: pg.wait_for_selector("table.diff", timeout=60000), keep=0.5, label="diff")
    hold(0.3)
    zoom(pg.locator("table.diff td.del del").first, z=1.7, sec=3.0)
    finish("history", 0.1)

    # 10. NEW: edit war explained
    scene("war")
    click(pg.locator(".tb-actions .btn.quiet", has_text="Back to today")); hold(0.2)
    click(pg.locator(".nav-main a", has_text="Edit wars"))
    waiting(lambda: pg.wait_for_selector("button.war", timeout=120000), keep=0.6, label="radar")
    hold(0.6)
    pg.locator(".war-tip").scroll_into_view_if_needed(); smooth_scroll(-140, steps=8); hold(0.6)
    war = pg.locator("button.war").first
    move_to(war, steps=20); hold(0.8)
    click(war)
    waiting(lambda: pg.wait_for_selector(".sides .side", timeout=180000), keep=1.0, label="war analysis")
    hold(1.0)
    zoom(pg.locator(".war-headline"), z=1.4, sec=2.4)
    pg.locator(".drawer").evaluate("e => e.scrollTo({top: 300, behavior: 'smooth'})"); hold(1.0)
    zoom(pg.locator(".sides"), z=1.35, sec=4.2, dy=0.35)
    move_to(pg.locator(".side.reverters .portrayal"), steps=18); hold(1.2)
    pg.locator(".drawer").evaluate("e => e.scrollTo({top: 760, behavior: 'smooth'})"); hold(1.4)
    zoom(pg.locator(".verdicts"), z=1.4, sec=2.8)
    finish("war", 0.2)
    pg.keyboard.press("Escape"); hold(0.4)

    # 11. editor studio: NPOV
    scene("studio")
    click(pg.locator(".nav-main a", has_text="Editor studio"))
    pg.wait_for_selector(".studio-features"); hold(0.8)
    click(pg.locator(".chips .chip", has_text="Talvisota"))
    waiting(lambda: pg.wait_for_selector(".studio-article p.pick", timeout=60000), keep=0.5, label="studio open")
    hold(0.4)
    click(pg.locator(".studio-article p.pick").nth(1), dy=0.3); hold(0.5)
    click(pg.locator(".task", has_text="Neutrality"))
    waiting(lambda: pg.wait_for_selector(".sdiff", timeout=180000), keep=1.0, label="npov")
    pg.locator(".studio-panel").evaluate("e => e.scrollTo({top: 260, behavior: 'smooth'})"); hold(0.9)
    zoom(pg.locator(".issues li").first, z=1.5, sec=2.2)
    pg.locator(".studio-panel").evaluate("e => e.scrollTo({top: 520, behavior: 'smooth'})"); hold(0.9)
    zoom(pg.locator(".sdiff"), z=1.45, sec=2.4, dy=0.3)
    finish("studio", 0.1)

    # 12. illustrate + edit
    scene("illustrate")
    pg.locator(".studio-panel").evaluate("e => e.scrollTo({top: 0, behavior: 'smooth'})"); hold(0.4)
    click(pg.locator(".seg button", has_text="Illustrate")); hold(0.3)
    click(pg.locator(".chip", has_text="Watercolour"))
    click(pg.locator(".btn.primary", has_text="Generate"))
    waiting(lambda: pg.wait_for_selector(".gen img", timeout=240000), keep=1.2, label="image")
    pg.locator(".studio-panel").evaluate("e => e.scrollTo({top: 9999, behavior: 'smooth'})"); hold(1.0)
    inp = pg.locator(".edit-box input")
    click(inp); pg.keyboard.type("turn it into a snowy night scene with moonlight", delay=28); hold(0.3)
    click(pg.locator(".edit-box .btn.primary"))
    waiting(lambda: pg.wait_for_selector(".thumbs img >> nth=1", timeout=240000), keep=1.0, label="image edit")
    pg.locator(".studio-panel").evaluate("e => e.scrollTo({top: 9999, behavior: 'smooth'})"); hold(0.8)
    zoom(pg.locator(".gen img"), z=1.6, sec=2.8)
    finish("illustrate", 0.1)

    # 13. language lens
    scene("lens")
    click(pg.locator(".nav-main a", has_text="Language lens")); hold(0.4)
    click(pg.locator(".chips .chip", has_text="Talvisota"))
    waiting(lambda: pg.wait_for_selector(".lens-sum", timeout=240000), keep=1.0, label="lens")
    hold(0.8); smooth_scroll(330, steps=24, pause=0.035); hold(1.2)
    zoom(pg.locator(".lens-tbl tbody tr").first, z=1.3, sec=2.6)
    finish("lens", 0.1)

    # 14. outro card
    pg.evaluate("() => { window.__cap(''); window.__prog(1); }")
    pg.evaluate("() => window.__card('outro')")
    scene("outro"); finish("outro", 2.2)
    log["end"] = round(now(), 3)
    video_path = pg.video.path()
    ctx.close(); b.close()

log["video"] = str(video_path)
save()
print("raw video:", video_path)
print(f"raw length {log['end']:.0f}s, cut {cut_total:.0f}s -> final ≈ {log['end'] - cut_total:.0f}s")
