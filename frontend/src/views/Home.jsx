import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Clock, Globe2, MessageCircleQuestion, Sparkles, Swords, Wand2 } from "lucide-react";
import { useApp } from "../store";
import { api, fmtDate, fmtMonth, nf } from "../lib";
import { Skeleton, Spark } from "../components/ui";
import { SearchBox } from "../components/shell";
import { EXAMPLES } from "./Ask";

const Box = ({ tone, title, children, delay = 0 }) => (
  <motion.section className={"mp-box " + tone} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
    <h2 className="mp-h">{title}</h2>
    <div className="mp-body">{children}</div>
  </motion.section>
);

export default function Home({ stats }) {
  const { go } = useApp();
  const [h, setH] = useState(null);
  const [wars, setWars] = useState(null);
  useEffect(() => {
    api("/api/home").then(setH).catch(() => {});
    api("/api/radar").then((r) => {
      const seen = new Set(), out = [];
      for (const w of r.wars || []) { if (!seen.has(w.page_id)) { seen.add(w.page_id); out.push(w); } if (out.length === 5) break; }
      setWars(out);
    }).catch(() => {});
  }, []);
  const A = ({ o, label }) => <a href={`#machine/${o.page_id}`}>{label || o.title}</a>;
  const d = h?.dyk || {};
  const facts = h ? [
    d.oldest && <>… that the oldest article in the history of Finland, <A o={d.oldest} />, was first written on <b>{fmtDate(d.oldest.first_edit)}</b>?</>,
    d.most_edited && <>… that <A o={d.most_edited} /> has been saved <b>{nf(d.most_edited.versions)}</b> times, more than any other article on Finnish history?</>,
    d.most_editors && <>… that <b>{nf(d.most_editors.n)}</b> different people have edited <A o={d.most_editors} />?</>,
    d.most_vandalised && <>… that vandalism on <A o={d.most_vandalised} /> has been reverted <b>{nf(d.most_vandalised.n)}</b> times?</>,
    d.oldest_passage && <>… that a passage in <A o={d.oldest_passage} /> has stood unchanged since <b>{fmtDate(d.oldest_passage.since)}</b>?</>,
    d.biggest_cut && <>… that the largest single edit removed <b>{nf(-d.biggest_cut.delta)}</b> bytes from <A o={d.biggest_cut} /> on {fmtDate(d.biggest_cut.ts)}?</>,
    d.anon && <>… that <b>{d.anon.pct}%</b> of all {nf(d.anon.n)} edits were made by anonymous editors?</>,
  ].filter(Boolean) : [];
  const f = h?.featured;
  const today = h ? new Date(h.date + "T00:00:00Z") : new Date();

  return (
    <div className="home">
      <motion.div className="mp-banner" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="agent-badge"><Sparkles size={13} /> AI agent for Wikipedia</div>
        <div className="mp-welcome">Meet <span className="accent">WikiPilot</span>.</div>
        <div className="mp-sub">Search engines show you today's Wikipedia. <b>WikiPilot has read every version ever written.</b></div>
        <SearchBox className="ask-box" big placeholder="Ask Wikipedia — now, or as it was on any day since 2003"
          onPage={(r) => go(`machine/${r.page_id}`)} onAsk={(q) => go(`ask/${encodeURIComponent(q)}`)} />
        <div className="chips">
          {EXAMPLES.slice(0, 3).map((e) => (
            <button key={e.q} className="chip" onClick={() => go(`ask/${encodeURIComponent(e.q)}`)}><b>{e.t}</b>{e.q}</button>
          ))}
        </div>
      </motion.div>

      <div className="mp-grid">
        <div className="mp-col">
          <Box tone="green" title="From today's featured article" delay={0.05}>
            {!f ? <Skeleton lines={6} title /> : <>
              <div className="feat-spark"><Spark months={f.months} height={54} /><div>{nf(f.versions)} versions, {new Date(f.first_edit + "Z").getUTCFullYear()}–2026</div></div>
              <div className="feat-title"><a href={`#machine/${f.page_id}`}>{f.title}</a></div>
              {f.lead.map((p, i) => <p key={i}>{p.length > 420 ? p.slice(0, 420) + "…" : p}</p>)}
              {f.first_text && <div className="feat-then">Its very first version, {fmtDate(f.first_edit)}: “{f.first_text.slice(0, 220)}{f.first_text.length > 220 ? "…" : ""}”</div>}
              <div className="more"><a href={`#machine/${f.page_id}`}>Read it through time <ArrowRight size={13} /></a> · <a href={`#machine/${f.page_id}/today/history`}>View history</a></div>
            </>}
          </Box>
          <Box tone="green" title="Did you know …" delay={0.1}>
            {!h ? <Skeleton lines={6} /> : <ul>{facts.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            <div className="more"><a href="#radar">More from the edit history <ArrowRight size={13} /></a></div>
          </Box>
        </div>
        <div className="mp-col">
          <Box tone="blue" title="In the edit wars" delay={0.08}>
            {!wars ? <Skeleton lines={5} /> : <ul>{wars.map((w) => (
              <li key={w.page_id + w.month}><b>{fmtMonth(w.month)}</b> – <A o={w} />: {w.war_reverts} reverts between named editors in one month. <a href={`#radar/${w.page_id}/${w.month}`}>Why they fought</a></li>
            ))}</ul>}
            <div className="more"><a href="#radar">All edit wars <ArrowRight size={13} /></a></div>
          </Box>
          <Box tone="blue" title="On this day in Wikipedia's history" delay={0.12}>
            {!h ? <Skeleton lines={6} /> : <>
              <div className="otd-date">{today.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}</div>
              <ul>
                {h.on_this_day.map((o) => (
                  <li key={o.year + "-" + o.page_id}><span className="otd-year">{o.year}</span> – <A o={o} /> was edited {o.edits} times that day{+o.wars > 0 && <>, with <span className="warc">{o.wars} reverts between editors</span></>}. <a href={`#machine/${o.page_id}/${o.year}-${h.date.slice(5)}`}>See it then</a></li>
                ))}
                {h.born.map((o) => <li key={"b" + o.page_id}><span className="otd-year">{o.year}</span> – the article <A o={o} /> was created.</li>)}
              </ul>
            </>}
          </Box>
        </div>
      </div>

      <Box tone="grey" title="Other areas of WikiPilot" delay={0.15}>
        <div className="mp-areas">
          {[["ask", MessageCircleQuestion, "Ask Wikipedia", "Grounded, cited answers from Wikipedia now, as of any date, then vs now, or how the answer drifted."],
            ["machine", Clock, "Time machine", "Read any article on any day, watch it rewrite itself, see text age and blame any sentence."],
            ["studio", Wand2, "Editor studio", "Gemini checks neutrality and citations, tightens prose, and illustrates sections."],
            ["radar", Swords, "Edit wars", "Every revert in 862,076 versions: where editors disagree, and when."],
            ["lens", Globe2, "Language lens", "The same topic in Finnish, Swedish and English Wikipedia, compared."]].map(([k, Icon, t, s]) => (
            <a key={k} href={"#" + k} className="area"><Icon size={20} /><b>{t}</b><span>{s}</span></a>
          ))}
        </div>
      </Box>
    </div>
  );
}
