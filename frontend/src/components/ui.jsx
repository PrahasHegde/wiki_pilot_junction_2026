import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Database, ChevronDown } from "lucide-react";
import { END, START, YEAR_MS, esc, fmtShort, monthTime, nf, utc, xOf } from "../lib";

// The loading mark: WikiPilot's globe turning (meridians sweep like a rotating Earth) while the
// clock hand runs — "the encyclopedia, moving through time".
export const Globe = ({ size = 18, className = "" }) => (
  <svg className={"globe-loader " + className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="28" className="gl-ring" />
    <path d="M6 22h52M4 32h56M6 42h52" className="gl-lat" />
    <ellipse cx="32" cy="32" rx="14" ry="28" className="gl-mer m1" />
    <ellipse cx="32" cy="32" rx="14" ry="28" className="gl-mer m2" />
    <ellipse cx="32" cy="32" rx="14" ry="28" className="gl-mer m3" />
    <path d="M32 32 L32 12" className="gl-hand" />
    <circle cx="32" cy="32" r="3" className="gl-pin" />
  </svg>
);

export const Spinner = ({ label }) => (
  <div className="loading" role="status"><Globe size={22} />{label}</div>
);

export const Skeleton = ({ lines = 4, title = false }) => (
  <div className="skel" aria-hidden="true">
    {title && <div className="skel-line skel-title" />}
    {Array.from({ length: lines }, (_, i) => (
      <div key={i} className="skel-line" style={{ width: `${70 + ((i * 37) % 30)}%` }} />
    ))}
  </div>
);

export const Kpis = ({ items }) => (
  <div className="kpis">
    {items.map(([b, s], i) => (
      <motion.div className="kpi" key={s} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
        <b>{b}</b><span>{s}</span>
      </motion.div>
    ))}
  </div>
);

const SQLKW = /\b(WITH|SELECT|FROM|WHERE|JOIN|USING|ORDER BY|GROUP BY|LIMIT|AS OF|FOR SYSTEM_TIME|ALL|TIMESTAMP|UNION ALL|OVER|PARTITION BY|WINDOW|MATCH|AGAINST|IN BOOLEAN MODE|VEC_DISTANCE_COSINE|VEC_FromText|LOCATE|LAG|ROW_NUMBER|COALESCE|LEFT JOIN|HAVING|SUM|COUNT|MIN|MAX|BETWEEN)\b/g;

// "Under the hood": every SQL statement a view ran, with its time.
export function Hood({ items, title = "Under the hood: the SQL behind this page" }) {
  const [open, setOpen] = useState(false);
  if (!items || !items.length) return null;
  const total = items.reduce((a, i) => a + i.ms, 0);
  return (
    <div className={"hood" + (open ? " open" : "")}>
      <button className="hood-h" onClick={() => setOpen(!open)}>
        <Database size={15} /> {title} <span className="hood-meta">{items.length} steps · {nf(total)} ms</span>
        <ChevronDown size={16} className="chev" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="trace" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            {items.map((i, k) => (
              <div className="tq" key={k}>
                <div className="tq-head"><span>{i.label}</span><span className="tq-ms">{i.ms} ms{i.rows != null ? ` · ${i.rows} rows` : ""}</span></div>
                {i.sql && <pre dangerouslySetInnerHTML={{ __html: esc(i.sql).replace(SQLKW, '<span class="kw">$1</span>') }} />}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Tiny edits-per-month chart over 2003–2026; red where named editors fought.
export function Spark({ months, height = 50 }) {
  if (!months || !months.length) return <div style={{ height }} />;
  const W = 300, max = Math.max(...months.map((m) => +m.edits));
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }}>
      {months.map((m) => {
        const x = xOf(monthTime(m.month)) * W, h = Math.max(1, Math.sqrt(m.edits / max) * (height - 4));
        return <rect key={m.month} x={x.toFixed(1)} y={height - h} width="1.2" height={h} fill={+m.war_reverts >= 3 ? "var(--war)" : "var(--bar)"} />;
      })}
    </svg>
  );
}

// When a passage was on Wikipedia, plus a stability badge.
export function Life({ since, until }) {
  if (!since) return null;
  const s = utc(since), u = until ? utc(until) : null;
  const a = xOf(s), b = xOf(u || END), age = (Date.now() - s) / YEAR_MS;
  return (
    <>
      <span className="life" title="When this passage was on Wikipedia">
        <span className="lifebar"><i className={u ? "gone" : ""} style={{ left: `${a * 100}%`, width: `${Math.max(2, (b - a) * 100)}%` }} /></span>
        {u ? `${new Date(s).getUTCFullYear()}–${new Date(u).getUTCFullYear()}` : `since ${new Date(s).getUTCFullYear()}`}
      </span>
      {u ? <span className="badge removed">since removed</span> : age >= 5 ? <span className="badge stable">stable {Math.floor(age)} y</span> : age < 1 ? <span className="badge fresh">new</span> : null}
    </>
  );
}

// Wikipedia-style reference preview on hovering a superscript citation.
export function CitePopover({ sources, eraText }) {
  const [p, setP] = useState(null);
  useEffect(() => {
    const over = (e) => {
      const c = e.target.closest && e.target.closest("sup.ref");
      if (!c) return setP(null);
      const s = (sources || []).find((s) => s.n === +c.dataset.n);
      if (!s) return;
      const r = c.getBoundingClientRect();
      setP({ s, x: Math.min(innerWidth - 376, Math.max(8, r.left - 30)), y: r.bottom + 8, top: r.top });
    };
    const click = (e) => {
      const c = e.target.closest && e.target.closest("sup.ref");
      if (!c) return;
      const li = document.getElementById("ref-" + c.dataset.n);
      if (!li) return;
      li.scrollIntoView({ behavior: "smooth", block: "center" });
      li.classList.add("flash", "open");
      setTimeout(() => li.classList.remove("flash"), 1500);
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("click", click);
    return () => { document.removeEventListener("mouseover", over); document.removeEventListener("click", click); };
  }, [sources]);
  return (
    <AnimatePresence>
      {p && (
        <motion.div className="pop" key={p.s.n} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          style={{ left: p.x, top: p.y + 230 > innerHeight ? p.top - 230 : p.y }}>
          <div className="pop-t">{p.s.title}</div>
          <div className="pop-m">{p.s.section || "Introduction"} · {eraText(p.s)}</div>
          <div className="pop-x">{p.s.text.slice(0, 340)}{p.s.text.length > 340 ? "…" : ""}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const Page = ({ children, k }) => (
  <motion.div key={k} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
    {children}
  </motion.div>
);

export const tierLabel = (deep) => (deep ? <span className="tier hot">hot · InnoDB</span> : <span className="tier s3">cold · S3</span>);
export { fmtShort, START };
