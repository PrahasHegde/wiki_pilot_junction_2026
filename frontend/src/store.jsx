// App-wide state: the moment in time, the theme, and hash routing.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { END, START, YEAR_MS, utc } from "./lib";

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// #home  #ask/<q>[/<date>]  #machine/<id>[/<date>|today][/history|compare]  #lens/<id>  #studio/<id>  #radar
function parseHash() {
  const [view, a, b, c] = location.hash.slice(1).split("/").map(decodeURIComponent);
  return { view: view || "home", a, b, c };
}

export function AppProvider({ children }) {
  const [route, setRoute] = useState(parseHash);
  const [at, setAtRaw] = useState(() => {
    const r = parseHash();
    const d = r.view === "machine" ? r.b : r.view === "ask" ? r.b : null;
    const t = d && d !== "today" ? utc(d) : NaN;
    return Number.isFinite(t) ? t : null;
  });
  const [playing, setPlaying] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { return new URLSearchParams(location.search).get("theme") || localStorage.getItem("theme") || ""; } catch { return ""; }
  });

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try { if (theme) localStorage.setItem("theme", theme); } catch {}
  }, [theme]);
  const toggleTheme = () => {
    const dark = getComputedStyle(document.documentElement).colorScheme === "dark";
    setTheme(dark ? "light" : "dark");
  };

  useEffect(() => {
    // In-app links can carry a moment (#machine/1256/2008-03-28, #ask/q/2010-01-01): move the time bar.
    const on = () => {
      const r = parseHash();
      setRoute(r);
      if ((r.view === "machine" || r.view === "ask" || r.view === "studio") && r.b && r.b !== "today") {
        const t = utc(r.b.length === 7 ? r.b + "-01" : r.b);
        if (Number.isFinite(t)) setAtRaw(Math.max(START, Math.min(END, t)));
      }
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);

  const go = useCallback((hash) => {
    if (location.hash !== "#" + hash) location.hash = hash;
    else setRoute(parseHash());
    scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  // Replace the URL without navigating (keeps deep links in sync with state).
  const sync = useCallback((hash) => history.replaceState(null, "", "#" + hash), []);

  const setAt = useCallback((t) => {
    if (t == null) return setAtRaw(null);
    t = Math.max(START, Math.min(END, t));
    setAtRaw(END - t < 86400000 * 5 ? null : t);
  }, []);

  // ▶ Play history: half a year every 1.6 s.
  const timer = useRef(null);
  const stop = useCallback(() => { clearInterval(timer.current); timer.current = null; setPlaying(false); }, []);
  const play = useCallback((from) => {
    if (timer.current) return stop();
    let t = from;
    setAt(t); setPlaying(true);
    timer.current = setInterval(() => {
      t += YEAR_MS / 2;
      if (t >= END) { setAt(END); stop(); } else setAt(t);
    }, 1600);
  }, [setAt, stop]);
  useEffect(() => () => clearInterval(timer.current), []);

  const value = { route, go, sync, at, setAt, playing, play, stop, toggleTheme, paletteOpen: null };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
