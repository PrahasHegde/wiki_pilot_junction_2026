import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, History, Sparkles } from "lucide-react";
import { useApp } from "../store";
import { WIKI, fmtDate, fmtShort, isoDay, md } from "../lib";
import { CitePopover, Hood, Life, Skeleton } from "../components/ui";
import { SearchBox } from "../components/shell";

export const EXAMPLES = [
  { q: "What did Wikipedia say about the 1918 prison camps in 2008, and what has changed since?", t: "then vs now" },
  { q: "How has Wikipedia's account of who started the Winter War changed over the years?", t: "drift" },
  { q: "Who led the Finnish armed forces in the Winter War?", t: "now" },
  { q: "Mitä Wikipedia kertoi Lapuanliikkeestä vuonna 2007?", t: "as of 2007" },
  { q: "How did Finland's NATO membership come about?", t: "now" },
];

const MODES = {
  now: () => "Today's Wikipedia",
  asof: (p) => "As of " + (p.date ? fmtDate(p.date) : ""),
  compare: (p) => `Then (${(p.date || "").slice(0, 4)}) vs now`,
  drift: () => "Drift, 2005 → today",
};
const HAT = {
  now: () => <>This answer reflects Wikipedia <b>as it stands today</b>. Drag the time bar to ask the past.</>,
  asof: (p) => <>This answer reflects Wikipedia <b>as it stood on {p.date ? fmtDate(p.date) : "that date"}</b>, not as it is today.</>,
  compare: (p) => <>This answer compares Wikipedia <b>as of {p.date ? fmtDate(p.date) : "then"}</b> with Wikipedia <b>today</b>. Green citations are from then.</>,
  drift: () => <>This answer traces how Wikipedia's account <b>changed between 2005 and today</b>, era by era.</>,
};

export default function Ask() {
  const { route, go, at } = useApp();
  const q = route.a || "";
  const [plan, setPlan] = useState(null);
  const [sources, setSources] = useState([]);
  const [text, setText] = useState("");
  const [drift, setDrift] = useState(null);
  const [trace, setTrace] = useState([]);
  const [phase, setPhase] = useState("idle"); // idle | planning | searching | writing | done | error
  const [err, setErr] = useState("");
  const buf = useRef("");

  useEffect(() => {
    if (!q) { setPhase("idle"); return; }
    setPlan(null); setSources([]); setText(""); setDrift(null); setTrace([]); setErr(""); setPhase("planning"); buf.current = "";
    const date = at ? isoDay(at) : "";
    const es = new EventSource(`/api/ask?q=${encodeURIComponent(q)}` + (date ? `&date=${date}` : ""));
    let raf = 0;
    es.addEventListener("plan", (e) => { setPlan(JSON.parse(e.data)); setPhase("searching"); });
    es.addEventListener("sources", (e) => { setSources(JSON.parse(e.data)); setPhase("writing"); });
    es.addEventListener("token", (e) => {
      buf.current += JSON.parse(e.data);
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; setText(buf.current); });
    });
    es.addEventListener("drift", (e) => setDrift(JSON.parse(e.data)));
    es.addEventListener("trace", (e) => setTrace(JSON.parse(e.data)));
    es.addEventListener("error", (e) => { if (e.data) { setErr(JSON.parse(e.data)); setPhase("error"); } });
    es.addEventListener("done", () => { es.close(); cancelAnimationFrame(raf); setText(buf.current); setPhase((p) => (p === "error" ? p : "done")); });
    return () => { es.close(); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const ask = (text) => go(`ask/${encodeURIComponent(text)}${at ? "/" + isoDay(at) : ""}`);
  const eraText = (s) => ({ then: "Wikipedia then", now: "Wikipedia today", asof: "Wikipedia as of " + (plan?.date ? fmtDate(plan.date) : "") }[s.era] || `Wikipedia in ${s.era}`)
    + (s.version_saved ? `, version of ${fmtShort(s.version_saved)}` : "");

  return (
    <div>
      <h1 className="firstHeading">Ask Wikipedia</h1>
      <div className="siteSub">Answers from Wikipedia exactly as it stood at the moment on the time bar, and from no other source.</div>
      <SearchBox key={q} className="ask-box" placeholder="Ask anything, e.g. how many died in the 1918 prison camps?" onPage={(r) => go(`machine/${r.page_id}`)} onAsk={ask} />
      <div className="chips left">
        {EXAMPLES.map((e) => <button key={e.q} className="chip" onClick={() => ask(e.q)}><b>{e.t}</b>{e.q}</button>)}
      </div>

      {q && (
        <motion.div className="answer-area" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="question"><Sparkles size={16} /> {q}</div>
          {plan && <div className="hatnote">{(HAT[plan.mode] || HAT.now)(plan)}</div>}
          <div className="plan">
            {phase === "planning" && <span className="step"><span className="spin" />Reading the question for time…</span>}
            {plan && <>
              <span className="pill mode">{(MODES[plan.mode] || MODES.now)(plan)}</span><span>searched for</span>
              <span className="pill">“{plan.search_fi}”</span>{(plan.keywords_fi || []).map((k) => <span className="pill" key={k}>{k}</span>)}
            </>}
          </div>

          <article className="answer mw-body">
            {err ? <p className="err">{err}</p>
              : drift ? <Drift d={drift} sources={sources} />
              : text ? <div className={phase === "writing" ? "streaming" : ""} dangerouslySetInnerHTML={{ __html: md(text, sources) }} />
              : phase === "searching" ? <><div className="step"><span className="spin" />Searching Wikipedia's past…</div><Skeleton lines={5} /></>
              : phase === "writing" ? <><div className="step"><span className="spin" />Writing an answer from these {sources.length} passages only…</div><Skeleton lines={5} /></>
              : phase === "planning" ? <Skeleton lines={5} /> : null}
          </article>

          <AnimatePresence>
            {sources.length > 0 && (
              <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <h2 className="refs-h">References</h2>
                <ol className="references">
                  {sources.map((s) => <Ref key={s.n} s={s} />)}
                </ol>
              </motion.section>
            )}
          </AnimatePresence>
          <Hood items={trace} title="Under the hood: the SQL behind this answer" />
          <CitePopover sources={sources} eraText={eraText} />
        </motion.div>
      )}
    </div>
  );
}

function Ref({ s }) {
  const [open, setOpen] = useState(false);
  const era = ["then", "now", "asof"].includes(s.era) ? s.era : "then";
  return (
    <li id={"ref-" + s.n} className={open ? "open" : ""}>
      <span className="ref-title">“{s.title}”</span> <span className="ref-sec">§ {s.section || "Introduction"}</span>
      <div className="ref-text" onClick={() => setOpen(!open)}>{s.text}</div>
      <div className="ref-meta">
        <span className={"era " + era}>{s.era === "asof" ? "as of" : s.era}</span>
        <Life since={s.since} until={s.until} />
        <a href={WIKI + s.oldid} target="_blank" rel="noopener">version of {fmtShort(s.version_saved)} <ExternalLink size={11} /></a>
        <a href={`#machine/${s.page_id}/${(s.version_saved || "").slice(0, 10) || "today"}`}><History size={11} /> time machine</a>
      </div>
    </li>
  );
}

function Drift({ d, sources }) {
  return (
    <div className="drift">
      {(d.eras || []).map((e, i) => (
        <motion.div key={e.year} className={"drift-era" + (e.changed ? " changed" : "")} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}>
          <h3>{e.year === "now" ? "Today" : e.year}{e.changed && e.change && <span className="drift-change">{e.change}</span>}</h3>
          <div dangerouslySetInnerHTML={{ __html: md(e.answer, sources) }} />
        </motion.div>
      ))}
      <div className="drift-summary"><strong>How the story changed.</strong> <span dangerouslySetInnerHTML={{ __html: md(d.summary || "", sources) }} /></div>
    </div>
  );
}
