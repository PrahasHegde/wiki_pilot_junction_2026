import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, Flame, GitCompare, History, BookOpen, Globe2, Quote, Undo2 } from "lucide-react";
import { useApp } from "../store";
import { DIFF, END, START, WIKI, YEAR_MS, api, fmtDate, fmtShort, fmtTime, isoDay, monthTime, nf, splitSentences, utc, wtx, xOf } from "../lib";
import { Hood, Skeleton, Spark, Spinner, tierLabel } from "../components/ui";
import { SearchBox } from "../components/shell";

const EXAMPLE_TITLES = ["Talvisota", "Suomen sisällissota", "Urho Kekkonen", "Carl Gustaf Emil Mannerheim", "Lapuanliike", "Sanna Marin", "Koronaviruspandemia Suomessa"];

export default function Machine({ onPlayFrom }) {
  const { route, go, sync, at, setAt, playing } = useApp();
  const id = route.a ? +route.a : null;
  const mode = ["history", "compare"].includes(route.c) ? route.c : "read";
  const [page, setPage] = useState(null);
  const [tl, setTl] = useState(null);
  const [view, setView] = useState(null);     // article | diff
  const [trace, setTrace] = useState([]);
  const [blame, setBlame] = useState(null);
  const [picked, setPicked] = useState(null);
  const [cmpDate, setCmpDate] = useState("2026-10-01");
  const [diffPair, setDiffPair] = useState(null); // explicit (a, b) from history "prev"/"cur"
  const [showAge, setShowAge] = useState(() => new URLSearchParams(location.search).has("age"));
  const [ages, setAges] = useState(null);
  const req = useRef(0);
  const atDay = at ? isoDay(at) : "2026-10-01";

  // page + timeline
  useEffect(() => {
    if (!id) return;
    setPage(null); setTl(null); setBlame(null); setPicked(null);
    api(`/api/page/${id}`).then((p) => { setPage(p); onPlayFrom(utc(p.first_edit) + 120 * 86400000); });
    api(`/api/timeline/${id}`).then(setTl);
  }, [id, onPlayFrom]);

  // keep the URL in sync with the moment and the tab
  useEffect(() => { if (id) sync(`machine/${id}/${at ? isoDay(at) : "today"}${mode !== "read" ? "/" + mode : ""}`); }, [id, at, mode, sync]);

  // the article (or diff) at the moment on the time bar
  useEffect(() => {
    if (!id || mode === "history") return;
    const my = ++req.current;
    const t = setTimeout(async () => {
      if (!playing) setView(null);
      const r = mode === "compare"
        ? await api(`/api/diff/${id}?a=${encodeURIComponent(diffPair ? diffPair[0] : atDay)}&b=${encodeURIComponent(diffPair ? diffPair[1] : cmpDate)}`)
        : await api(`/api/article/${id}?at=${atDay}`);
      if (my !== req.current) return;
      setView({ kind: mode === "compare" ? "diff" : "article", ...r });
      setTrace(r.trace || []);
      setAges(null);
    }, 180);
    return () => clearTimeout(t);
  }, [id, atDay, mode, cmpDate, diffPair, playing]);

  // text age
  useEffect(() => {
    if (!showAge || !id || !view || view.kind !== "article" || view.error) return;
    let live = true;
    api(`/api/ages/${id}?at=${atDay}`).then((r) => { if (live) { setAges(Object.fromEntries(r.ages.map((a) => [a.i, a.since]))); setTrace((t) => [...t, ...(r.trace || [])]); } });
    return () => { live = false; };
  }, [showAge, id, view, atDay]);

  const setMode = (m) => { setDiffPair(null); go(`machine/${id}/${at ? isoDay(at) : "today"}${m !== "read" ? "/" + m : ""}`); };

  const doBlame = async (sentence, key) => {
    setPicked(key);
    setBlame({ loading: true, sentence });
    const b = await api("/api/blame", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page_id: id, sentence, at: atDay }) });
    setBlame({ ...b, sentence });
    if (innerWidth <= 1100) document.getElementById("blame")?.scrollIntoView({ behavior: "smooth" });
  };

  if (!id) return <Picker onPick={(pid) => go(`machine/${pid}`)} />;

  const tabs = [["read", "Read", BookOpen], ["compare", "Compare", GitCompare], ["history", "View history", History]];
  return (
    <div>
      <div className="tabs">
        <div className="tabs-l"><a className={"tab" + (mode !== "history" ? " sel" : "")} href={`#machine/${id}`}>Article</a><a className="tab" href={`#lens/${id}`}><Globe2 size={13} /> Language lens</a></div>
        <div className="tabs-r">{tabs.map(([k, l, Icon]) => <button key={k} className={"tab" + (mode === k ? " sel" : "")} onClick={() => setMode(k)}><Icon size={13} /> {l}</button>)}</div>
      </div>
      <h1 className="firstHeading">{page ? page.title : <span className="skel-line skel-title" style={{ display: "inline-block", width: 240 }} />}</h1>
      <div className="siteSub">From Wikipedia, the free encyclopedia · <b>as it stood on {at ? fmtDate(at) : "1 October 2026 (latest)"}</b></div>

      <div className="tl-card">
        <div className="tl-legend"><span><i className="sw sw-bar" />edits per month</span><span><i className="sw sw-rv" />vandalism reverted</span><span><i className="sw sw-war" />edit war</span><span className="hint">click to jump in time</span></div>
        {tl ? <TimelineChart months={tl.months} at={at} onPick={setAt} /> : <div style={{ height: 120 }}><Spinner label={page ? `Reading ${nf(page.versions)} versions…` : "Reading the history…"} /></div>}
        {tl && <div className="duels">{tl.duels.length ? <><span>Who fought:</span>{tl.duels.map((d) => <span className="duel" key={d.a + d.b}>{d.a} ⇄ {d.b} <b>{d.reverts}</b></span>)}</> : <span>No edit wars between named editors detected.</span>}</div>}
      </div>

      {mode === "compare" && (
        <div className="cmp-bar"><GitCompare size={15} /> Compare {diffPair ? "two versions" : <>the version on the time bar with</>}
          {!diffPair && <input type="date" value={cmpDate} min="2003-01-01" max="2026-10-01" onChange={(e) => setCmpDate(e.target.value)} />}
          <button className="btn" onClick={() => { setDiffPair(null); setCmpDate(isoDay((at || END) - YEAR_MS)); }}>−1 year</button>
          <button className="btn" onClick={() => { setDiffPair(null); setCmpDate("2026-10-01"); }}>vs today</button>
        </div>
      )}

      <div className="reader-grid">
        <article className="reader mw-body">
          {mode === "history" ? <HistoryList tl={tl} at={at} onDiff={(a, b) => { setDiffPair([a, b || "2026-10-01"]); go(`machine/${id}/${at ? isoDay(at) : "today"}/compare`); setTimeout(() => setDiffPair([a, b || "2026-10-01"]), 0); }} onRead={(ts) => { setAt(utc(ts) + 1000); setMode("read"); }} />
            : !view ? <Skeleton lines={14} />
            : view.kind === "diff" ? <DiffView d={view} />
            : <ArticleView v={view} page={page} at={at} picked={picked} onBlame={doBlame} showAge={showAge} setShowAge={setShowAge} ages={ages} setAt={setAt} />}
        </article>
        <aside className="rail">
          {page && <Infobox page={page} months={tl?.months} />}
          <BlamePanel b={blame} page={page} setAt={setAt} />
        </aside>
      </div>
      <Hood items={[...(tl?.trace || []), ...trace]} />
    </div>
  );
}

function Picker({ onPick }) {
  const [chips, setChips] = useState([]);
  useEffect(() => {
    Promise.all(EXAMPLE_TITLES.map((t) => api(`/api/pages?q=${encodeURIComponent(t)}`).then((r) => r[0]))).then((r) => setChips(r.filter(Boolean)));
  }, []);
  return (
    <div>
      <h1 className="firstHeading">Time machine</h1>
      <div className="siteSub">Read any article on any day since 2003. Click any sentence to see who wrote it.</div>
      <SearchBox className="ask-box" placeholder="Find an article: Talvisota, Urho Kekkonen, Suomen sisällissota…" onPage={(r) => onPick(r.page_id)} autoFocus />
      <div className="chips left">{chips.map((r) => <button key={r.page_id} className="chip" onClick={() => onPick(r.page_id)}>{r.title} <span className="muted">· {nf(r.versions)}</span></button>)}</div>
    </div>
  );
}

function TimelineChart({ months, at, onPick }) {
  const ref = useRef(null);
  const [W, setW] = useState(900);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width || 900));
    ro.observe(ref.current); return () => ro.disconnect();
  }, []);
  const H = 120, pad = 16, max = Math.max(1, ...months.map((m) => +m.edits)), bw = Math.max(1, W / 286 - 0.6);
  const x = (t) => xOf(t) * W, years = [];
  for (let y = 2004; y <= 2026; y += 2) years.push(y);
  return (
    <svg ref={ref} className="tl" viewBox={`0 0 ${W} ${H}`} onClick={(e) => { const r = ref.current.getBoundingClientRect(); onPick(START + (END - START) * (e.clientX - r.left) / r.width); }}>
      {years.map((y) => { const xx = x(Date.UTC(y, 0, 1)); return <g key={y}><line x1={xx} x2={xx} y1="0" y2={H - pad} stroke="var(--border-muted)" /><text x={xx + 3} y={H - 3} fontSize="10" fill="var(--text-muted)">{y}</text></g>; })}
      {months.map((m) => {
        const xx = x(monthTime(m.month)), bh = Math.sqrt(m.edits / max) * (H - pad - 20), vand = m.reverts - m.war_reverts;
        return (
          <g key={m.month}>
            {+m.war_reverts >= 3 && <rect x={xx - 1} y="0" width={bw + 2} height={H - pad} fill="var(--war)" opacity=".1" />}
            <rect x={xx} y={H - pad - bh} width={bw} height={bh} fill="var(--bar)" opacity=".8"><title>{`${m.month}: ${m.edits} edits, ${m.reverts} reverts (${m.war_reverts} between named editors), ${m.editors} editors`}</title></rect>
            {vand > 0 && <circle cx={xx + bw / 2} cy="10" r={Math.min(4.5, 1.5 + Math.sqrt(vand))} fill="var(--vandal)" />}
            {+m.war_reverts > 0 && <circle cx={xx + bw / 2} cy={H - pad - bh - 6} r={Math.min(5.5, 2 + Math.sqrt(m.war_reverts))} fill="var(--war)" />}
          </g>
        );
      })}
      <motion.line animate={{ x1: x(at || END), x2: x(at || END) }} transition={{ type: "spring", stiffness: 300, damping: 30 }} y1="0" y2={H - pad} stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}

function ArticleView({ v, page, at, picked, onBlame, showAge, setShowAge, ages, setAt }) {
  if (v.error) return (
    <div className="ver-note old">This article did not exist yet on {at ? fmtDate(at) : "that date"}. It was first written on <b>{page && fmtDate(page.first_edit)}</b>.{" "}
      {page && <a onClick={() => setAt(utc(page.first_edit) + 86400000)}>Go there</a>}</div>
  );
  const m = v.meta, old = !!at && !!m.replaced, ref = at || END;
  const ageClass = (i) => {
    if (!showAge || !ages || !(i in ages)) return "";
    const y = ages[i] ? (ref - utc(ages[i])) / YEAR_MS : 0;
    return " age" + (y < 1 ? 0 : y < 3 ? 1 : y < 6 ? 2 : y < 10 ? 3 : 4);
  };
  return (
    <>
      <div className={"ver-note" + (old ? " old" : "")}>
        {old ? <>This is an <b>old revision</b> of this page, saved by </> : <>This is the version saved by </>}<b>{m.user}</b>{m.anonymous ? " (anonymous)" : ""} at {fmtTime(m.saved)}, {fmtDate(m.saved)}{m.comment ? ` (“${wtx(m.comment).slice(0, 110)}”)` : ""}.
        {old && <> It was replaced on {fmtDate(m.replaced)}.</>} <a href={WIKI + m.rev_id} target="_blank" rel="noopener">Open on Wikipedia <ExternalLink size={11} /></a>
        {m.tier === "s3" && <> · <span className="tier s3">read from S3 cold tier</span></>}
      </div>
      <div className="age-bar">
        <button className={"btn" + (showAge ? " primary" : "")} onClick={() => setShowAge(!showAge)}><Flame size={14} /> {showAge ? "Hide" : "Show"} text age</button>
        {showAge && <span className="age-legend">unchanged for: <i className="a0" />&lt;1 y <i className="a1" />1–3 y <i className="a2" />3–6 y <i className="a3" />6–10 y <i className="a4" />10+ y{!ages && <span className="spin" style={{ marginLeft: 10 }} />}</span>}
        {!showAge && <span className="muted">Tip: click any sentence to see who wrote it.</span>}
      </div>
      {!v.blocks.length && <p className="muted">The full text of this article's history is still being archived. Its timeline, infobox and history are complete.</p>}
      {v.blocks.map(([k, t], i) =>
        k === "h" ? <h2 key={i}>{t}</h2> : k === "h3" ? <h3 key={i}>{t}</h3> : (
          <p key={i} className={(k === "li" ? "li" : "") + ageClass(i)} title={showAge && ages && i in ages ? (ages[i] ? `Unchanged since ${fmtDate(ages[i])}` : "Changed within the last year") : undefined}>
            {splitSentences(t).map((s, j) => <span key={j} className={"s" + (picked === `${i}:${j}` ? " picked" : "")} onClick={() => onBlame(s, `${i}:${j}`)}>{s} </span>)}
          </p>
        ))}
    </>
  );
}

function Infobox({ page: p, months }) {
  const s = p.stats || {}, langs = (s.languages || []).filter((l) => l.lang !== "fi");
  const Row = ({ th, children, style }) => <tr><th>{th}</th><td style={style}>{children}</td></tr>;
  return (
    <motion.table className="infobox" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <caption>{p.title}</caption>
      <tbody>
        <tr><td colSpan="2" className="ib-spark"><Spark months={months} height={46} /><div className="ib-note">edits per month, 2003–2026{+s.war_reverts ? " · red: edit wars" : ""}</div></td></tr>
        <tr><td colSpan="2" className="ib-head">Life of the article</td></tr>
        <Row th="First version">{fmtDate(p.first_edit)}</Row>
        <Row th="Latest version">{fmtDate(p.last_edit)}</Row>
        <Row th="Versions">{nf(p.versions)}</Row>
        <Row th="Editors">{nf(s.editors)}{s.anon_pct != null && <span className="muted"> ({s.anon_pct}% of edits anonymous)</span>}</Row>
        <Row th="Reverts">{nf(s.reverts)}</Row>
        <Row th="· vandalism undone">{nf(s.vandalism_reverts)}</Row>
        <Row th="· edit-war reverts" style={{ color: +s.war_reverts ? "var(--war)" : undefined }}>{nf(s.war_reverts)}</Row>
        <tr><td colSpan="2" className="ib-head">In WikiPilot</td></tr>
        <Row th="Passages through time">{nf(s.passages)}</Row>
        <Row th="Full text">{tierLabel(p.deep)}</Row>
        {langs.length > 0 && <Row th="Other languages">{langs.map((l, i) => <span key={l.lang}>{i > 0 && " · "}<a href={l.url} target="_blank" rel="noopener">{l.lang === "sv" ? "Svenska" : "English"}</a></span>)}<br /><a href={`#lens/${p.page_id}`}>Compare languages →</a></Row>}
        <Row th="On Wikipedia"><a href={`https://fi.wikipedia.org/?curid=${p.page_id}`} target="_blank" rel="noopener">fi.wikipedia.org <ExternalLink size={11} /></a></Row>
      </tbody>
    </motion.table>
  );
}

function BlamePanel({ b, page, setAt }) {
  return (
    <div className="blame" id="blame">
      <h3><Quote size={16} /> Who wrote this?</h3>
      <AnimatePresence mode="wait">
        {!b ? (
          <motion.div key="empty" className="muted" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            Click any sentence in the article. WikiPilot checks <b>every saved version</b> in one SQL statement and shows when the sentence first appeared, who wrote it, and each time it was removed or restored.
          </motion.div>
        ) : (
          <motion.div key={b.sentence} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <div className="quote">{b.sentence}</div>
            {b.loading ? <Spinner label={`Checking all ${nf(page?.versions)} versions${page && !page.deep ? " straight from the S3 cold tier (about 20 s)" : ""}…`} />
              : b.error ? <p className="muted">{b.error}</p> : <>
                {b.story && <div className="story">{b.story}</div>}
                <div className="stats3">
                  <div className="stat"><b>{b.first ? new Date(utc(b.first.ts)).getUTCFullYear() : "?"}</b><span>first written</span></div>
                  <div className="stat"><b>{b.removed_times}</b><span>times removed</span></div>
                  <div className="stat"><b>{b.restored_times}</b><span>times restored</span></div>
                </div>
                <ul className="events">
                  {b.events.map((e) => (
                    <li key={e.rev_id}><span className={"k " + (e.kind === "added" ? "add" : "rm")}>{e.kind === "added" ? "+ added" : "− removed"}<small>{fmtShort(e.ts)}</small></span>
                      <span><b>{e.user}</b>{e.anon && <small className="inline"> (anon)</small>} · <a href={WIKI + e.rev_id} target="_blank" rel="noopener">version</a> · <a onClick={() => setAt(utc(e.ts) + 1000)}>go there</a>
                        {e.comment && <small>“{wtx(e.comment)}”</small>}</span></li>
                  ))}
                </ul>
                <p className="fine">Matched “{b.needle}” across {nf(b.versions_scanned)} versions in {nf(b.ms)} ms ({b.tier === "hot" ? "FOR SYSTEM_TIME ALL" : "S3 cold tier"} + LAG()).</p>
              </>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HistoryList({ tl, at, onDiff, onRead }) {
  const [shown, setShown] = useState(60);
  const vs = useMemo(() => (tl ? tl.versions.filter((v) => utc(v.ts) <= (at ? at + 86400000 : Infinity)).reverse() : []), [tl, at]);
  if (!tl) return <Skeleton lines={14} />;
  return (
    <>
      <div className="hist-head">Revision history{at && <> up to <b>{fmtDate(at)}</b></>}: {nf(vs.length)} versions. (cur) = difference with the latest version, (prev) = difference with the preceding version. Click a date to read that version.</div>
      <ul className="hist">
        {vs.slice(0, shown).map((v, i) => {
          const prev = vs[i + 1], d = v.delta || 0;
          return (
            <li key={v.rev_id} className={i === 0 && at ? "cur" : ""}>
              <span className="pm">(<a onClick={() => onDiff(v.ts, null)}>cur</a> | {prev ? <a onClick={() => onDiff(prev.ts, v.ts)}>prev</a> : "prev"})</span>{" "}
              <a onClick={() => onRead(v.ts)}>{fmtTime(v.ts)}, {fmtDate(v.ts)}</a>{" "}
              <b>{v.user}</b>{v.anon && <span className="tag anon">anon</span>} · ({nf(v.len)} bytes){" "}
              <span className={(d > 0 ? "plus" : d < 0 ? "minus" : "pm") + (Math.abs(d) >= 500 ? " big" : "")}>({d > 0 ? "+" : ""}{nf(d)})</span>{" "}
              {v.comment && <span className="cmt">({wtx(v.comment)})</span>}
              {v.revert && <span className="tag rv"><Undo2 size={10} /> revert</span>}{" "}
              <a href={WIKI + v.rev_id} target="_blank" rel="noopener" className="ext"><ExternalLink size={11} /></a>
            </li>
          );
        })}
      </ul>
      {vs.length > shown && <p><button className="btn" onClick={() => setShown(shown + 100)}>Show 100 older versions</button></p>}
    </>
  );
}

function DiffView({ d }) {
  if (d.error) return <p>{d.error}</p>;
  const s = d.stats;
  const W = (ws, side) => ws.map(([op, w], i) => op === "=" ? <span key={i}>{w} </span> : op === side ? (side === "-" ? <del key={i}>{w}</del> : <ins key={i}>{w}</ins>) : null);
  return (
    <>
      <div className="diff-stats"><span><b>{s.same}</b> unchanged</span><span><b>{s.changed}</b> edited</span><span className="minus"><b>{s.removed}</b> removed</span><span className="plus"><b>{s.added}</b> added</span>
        <a href={DIFF(d.a.rev_id, d.b.rev_id)} target="_blank" rel="noopener">same diff on Wikipedia <ExternalLink size={11} /></a></div>
      <table className="diff">
        <thead><tr><th><b>Revision as of {fmtTime(d.a.saved)}, {fmtDate(d.a.saved)}</b>{d.a.user}</th><th><b>Revision as of {fmtTime(d.b.saved)}, {fmtDate(d.b.saved)}</b>{d.b.user}</th></tr></thead>
        <tbody>
          {d.ops.map((o, i) =>
            o.op === "same" ? <tr key={i}><td colSpan="2" className="ctx">… {o.n} unchanged paragraph{o.n > 1 ? "s" : ""}{o.preview.length ? ": " + o.preview.map((p) => p[1]).join(" · ") : ""} …</td></tr>
            : o.op === "changed" ? <tr key={i}><td className="del">{W(o.words, "-")}</td><td className="ins">{W(o.words, "+")}</td></tr>
            : o.op === "removed" ? <tr key={i}><td className="del">{o.text}</td><td className="empty" /></tr>
            : <tr key={i}><td className="empty" /><td className="ins">{o.text}</td></tr>)}
        </tbody>
      </table>
    </>
  );
}
