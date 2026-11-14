import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, Command, Menu, Moon, Pause, Play, Search, Sun } from "lucide-react";
import { useApp } from "../store";
import { END, START, YEAR_MS, api, fmtDate, fmtShort, looksLikeQuestion, monthTime, nf, utc, xOf } from "../lib";

export const Logo = () => (
  <a className="logo" href="#home" aria-label="WikiPilot main page">
    <svg className="logo-mark" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="28" className="lm-globe" />
      <ellipse cx="32" cy="32" rx="12" ry="28" className="lm-line" />
      <path d="M4 32h56M9 18h46M9 46h46" className="lm-line" />
      <path d="M32 32 L32 13" className="lm-hand" /><path d="M32 32 L46 40" className="lm-hand" />
      <circle cx="32" cy="32" r="3.2" className="lm-pin" />
    </svg>
    <span className="logo-words"><span className="wordmark">WikiPilot</span><span className="tagline">Wikipedia, read through time</span></span>
  </a>
);

// Article suggestions as you type; a question becomes "Ask".
export function useSuggest(q, limit = 7) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!q.trim()) { setRows([]); return; }
    const t = setTimeout(async () => setRows((await api(`/api/pages?q=${encodeURIComponent(q.trim())}`)).slice(0, limit)), 130);
    return () => clearTimeout(t);
  }, [q, limit]);
  return rows;
}

export function SearchBox({ placeholder, onPage, onAsk, autoFocus, className = "search", big }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(-1);
  const [open, setOpen] = useState(false);
  const rows = useSuggest(q);
  const { at } = useApp();
  const canAsk = onAsk && q.trim().length > 2;
  const n = rows.length + (canAsk ? 1 : 0);
  const choose = (i) => {
    const text = q.trim(); setOpen(false);
    if (i < rows.length && rows[i]) { setQ(onAsk ? "" : rows[i].title); onPage(rows[i]); }
    else if (canAsk) { setQ(""); onAsk(text); }
  };
  const key = (e) => {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && n) { e.preventDefault(); setSel((sel + (e.key === "ArrowDown" ? 1 : -1) + n) % n); }
    if (e.key === "Enter") {
      e.preventDefault();
      if (sel >= 0) choose(sel); else if (canAsk && looksLikeQuestion(q)) choose(rows.length); else if (rows.length) choose(0); else if (canAsk) choose(rows.length);
    }
    if (e.key === "Escape") setOpen(false);
  };
  return (
    <form className={className + (big ? " big" : "")} role="search" onSubmit={(e) => e.preventDefault()}>
      <Search size={17} className="search-ico" />
      <input value={q} autoFocus={autoFocus} placeholder={placeholder} aria-label={placeholder}
        onChange={(e) => { setQ(e.target.value); setSel(-1); setOpen(true); }} onKeyDown={key}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {className === "search" && <kbd className="kbd">⌘K</kbd>}
      <AnimatePresence>
        {open && (rows.length > 0 || canAsk) && (
          <motion.div className="suggest" role="listbox" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {rows.map((r, i) => (
              <div key={r.page_id} className={"opt" + (i === sel ? " sel" : "")} onMouseDown={(e) => { e.preventDefault(); choose(i); }}>
                <b>{r.title}</b><small>{nf(r.versions)} versions{r.deep ? " · full history" : ""}</small>
              </div>
            ))}
            {canAsk && (
              <div className={"opt ask-opt" + (sel === rows.length ? " sel" : "")} onMouseDown={(e) => { e.preventDefault(); choose(rows.length); }}>
                Ask Wikipedia: “{q.trim()}”{at ? ` (as of ${fmtShort(at)})` : ""}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );
}

export function Header({ onMenu, onPalette }) {
  const { go, at, toggleTheme } = useApp();
  return (
    <header className="hdr">
      <button className="icon-btn" onClick={onMenu} aria-label="Main menu" title="Main menu"><Menu size={20} /></button>
      <Logo />
      <SearchBox placeholder="Search articles, or ask a question…" onPage={(r) => go(`machine/${r.page_id}`)} onAsk={(q) => go(`ask/${encodeURIComponent(q)}`)} />
      <div className="hdr-tools">
        <button className="icon-btn hide-sm" onClick={onPalette} title="Command palette (⌘K)"><Command size={18} /></button>
        <a className={"timepill" + (at ? " past" : "")} href="#timebar" title="The moment you are reading Wikipedia at">
          <Clock size={14} />{at ? fmtShort(at) : "Today"}
        </a>
        <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle dark mode" title="Day / night">
          <Sun size={18} className="only-dark" /><Moon size={18} className="only-light" />
        </button>
      </div>
    </header>
  );
}

// The time bar: one moment in time shared by every page.
export function TimeBar({ playFrom }) {
  const { at, setAt, playing, play, stop } = useApp();
  const [activity, setActivity] = useState([]);
  const canvas = useRef(null), track = useRef(null), dragging = useRef(false);
  useEffect(() => { api("/api/activity").then(setActivity).catch(() => {}); }, []);
  useEffect(() => {
    const draw = () => {
      const c = canvas.current; if (!c) return;
      const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
      c.width = w * dpr; c.height = h * dpr;
      const g = c.getContext("2d"); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
      if (!activity.length) return;
      const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      const max = Math.max(...activity.map((d) => d.edits)), bw = w / 285;
      for (const d of activity) {
        const t = monthTime(d.month); if (t < START || t > END) continue;
        const x = xOf(t) * w, v = Math.sqrt(d.edits / max);
        g.globalAlpha = 0.35 + 0.55 * v; g.fillStyle = css("--bar"); g.fillRect(x, h - v * (h - 3), Math.max(1, bw - 0.6), v * (h - 3));
        if (d.war_reverts > 0) { g.globalAlpha = Math.min(1, 0.25 + d.war_reverts / 40); g.fillStyle = css("--war"); g.fillRect(x, 0, Math.max(1, bw - 0.6), 3); }
      }
    };
    draw();
    const mo = new MutationObserver(draw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    addEventListener("resize", draw);
    return () => { removeEventListener("resize", draw); mo.disconnect(); };
  }, [activity]);
  const pos = (x) => { const r = track.current.getBoundingClientRect(); return START + (END - START) * Math.max(0, Math.min(1, (x - r.left) / r.width)); };
  const t = at || END;
  const years = [];
  for (let y = 2004; y <= 2026; y += 2) years.push(y);
  return (
    <section className={"timebar" + (at ? " past" : "")} id="timebar" aria-label="Time travel">
      <div className="tb-row">
        <div className="tb-label"><span className="tb-eyebrow">Reading Wikipedia as of</span>
          <AnimatePresence mode="popLayout"><motion.span key={at ? fmtDate(at) : "today"} className="tb-when" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>{at ? fmtDate(at) : "today"}</motion.span></AnimatePresence>
        </div>
        <div className="tb-actions">
          <button className={"btn" + (playing ? " primary" : "")} onClick={() => playing ? stop() : play(at && at < END - YEAR_MS / 2 ? at : playFrom || Date.UTC(2005, 0, 1))}>
            {playing ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play history</>}
          </button>
          {at && <button className="btn quiet" onClick={() => { stop(); setAt(null); }}>Back to today</button>}
        </div>
      </div>
      <div className="track" ref={track} role="slider" tabIndex={0} aria-label="Date" aria-valuetext={at ? fmtDate(at) : "today"}
        onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); setAt(pos(e.clientX)); }}
        onPointerMove={(e) => dragging.current && setAt(pos(e.clientX))}
        onPointerUp={() => (dragging.current = false)}
        onKeyDown={(e) => { const s = { ArrowLeft: -30, ArrowRight: 30, PageDown: -365, PageUp: 365 }[e.key]; if (s) { e.preventDefault(); setAt(t + s * 86400000); } }}>
        <canvas ref={canvas} />
        <div className="years">{years.map((y) => <span key={y} style={{ left: `${xOf(Date.UTC(y, 0, 1)) * 100}%` }}>{y}</span>)}</div>
        <div className="handle" style={{ left: `${xOf(t) * 100}%` }}><span /></div>
      </div>
    </section>
  );
}

const NAV = [["home", "Main page"], ["ask", "Ask Wikipedia"], ["machine", "Time machine"], ["radar", "Edit wars"], ["lens", "Language lens"], ["how", "How it works"]];

export function Sidebar({ stats, open, tryLinks }) {
  const { route } = useApp();
  return (
    <nav className={"sidebar" + (open ? " open" : "")} aria-label="Main menu">
      <div className="nav-h">Main menu</div>
      <ul>{NAV.map(([k, label]) => <li key={k}><a href={"#" + k} className={route.view === k ? "cur" : ""}>{label}</a></li>)}</ul>
      <div className="nav-h">Try</div>
      <ul>{tryLinks.map(([href, label]) => <li key={href}><a href={href}>{label}</a></li>)}</ul>
      {stats && <>
        <div className="nav-h">In numbers</div>
        <ul className="nav-stats">
          <li><b>{nf(stats.versions)}</b> versions</li><li><b>{nf(stats.pages)}</b> articles</li>
          <li><b>{nf(stats.passage_rows)}</b> passages with vectors</li><li><b>{nf(stats.articles_now)}</b> articles in fi · sv · en</li>
          <li><b>{nf(stats.s3_tables)}</b> tables in S3</li>
        </ul>
      </>}
      <div className="nav-h">Powered by</div>
      <ul className="nav-stats"><li>MariaDB 12.3 · vector index on system-versioned tables · S3 engine</li><li>Gemini embedding 2 · Gemini 3.8 Flash</li></ul>
    </nav>
  );
}

export const Footer = () => (
  <footer className="footer">
    <p>Article text from <a href="https://fi.wikipedia.org" target="_blank" rel="noopener">Wikipedia</a> (Finnish, Swedish, English) under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>; credit to Wikipedia's editors. WikiPilot is an independent project, not affiliated with the Wikimedia Foundation.</p>
    <p>Datasets: MariaDB Foundation · Built on MariaDB vector search, system-versioned tables and the S3 storage engine · Language by Gemini</p>
  </footer>
);
