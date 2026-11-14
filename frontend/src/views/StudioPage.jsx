// Editor studio as its own page: pick an article, then improve or illustrate it with Gemini.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BookMarked, ExternalLink, History, ImagePlus, Scale, Sparkles, Wand2 } from "lucide-react";
import { useApp } from "../store";
import { WIKI, api, fmtDate, isoDay, nf } from "../lib";
import { Skeleton, Spinner } from "../components/ui";
import { SearchBox } from "../components/shell";
import Studio from "./Studio";

const EXAMPLES = ["Talvisota", "Suomen sisällissota", "Lapuanliike", "Urho Kekkonen", "Carl Gustaf Emil Mannerheim", "Jatkosota"];
const FEATURES = [
  [Scale, "Neutrality check", "Finds loaded wording, unattributed opinions and one-sided framing, and proposes a neutral rewrite (NPOV)."],
  [BookMarked, "Citations needed", "Marks every claim a reviewer would tag, inserting {{lähde?}} where a source is missing."],
  [Sparkles, "Clarity & length", "Clearer sentences or a condensed version for the lead, with the facts unchanged, shown as a diff."],
  [ImagePlus, "Illustrate & edit", "Generate a period-accurate illustration of a section, then edit it in plain language, labelled AI-generated."],
];

export default function StudioPage() {
  const { route, go, at } = useApp();
  const id = route.a ? +route.a : null;
  const atDay = at ? isoDay(at) : "2026-10-01";
  const [page, setPage] = useState(null);
  const [view, setView] = useState(null);
  const [chips, setChips] = useState([]);

  useEffect(() => {
    Promise.all(EXAMPLES.map((t) => api(`/api/pages?q=${encodeURIComponent(t)}`).then((r) => r[0]))).then((r) => setChips(r.filter(Boolean)));
  }, []);
  useEffect(() => { if (id) { setPage(null); api(`/api/page/${id}`).then(setPage); } }, [id]);
  useEffect(() => {
    if (!id) return;
    let live = true;
    setView(null);
    const t = setTimeout(() => api(`/api/article/${id}?at=${atDay}`).then((r) => live && setView({ kind: "article", ...r })), 150);
    return () => { live = false; clearTimeout(t); };
  }, [id, atDay]);

  if (!id) return (
    <div>
      <h1 className="firstHeading">Editor studio</h1>
      <div className="siteSub">Gemini-powered tools for Wikipedia editors: check neutrality, find claims that need sources, tighten the prose, and illustrate a section.</div>
      <SearchBox className="ask-box" placeholder="Open an article in the studio: Talvisota, Lapuanliike, Kekkonen…" onPage={(r) => go(`studio/${r.page_id}`)} />
      <div className="chips left">{chips.map((c) => <button key={c.page_id} className="chip" onClick={() => go(`studio/${c.page_id}`)}>{c.title} <span className="muted">· {nf(c.versions)}</span></button>)}</div>
      <div className="studio-features">
        {FEATURES.map(([Icon, t, d], i) => (
          <motion.div key={t} className="sf" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <span className="sf-ico"><Icon size={18} /></span><b>{t}</b><span>{d}</span>
          </motion.div>
        ))}
      </div>
      <p className="hatnote">The studio opens the article <b>as it stood on the date on the time bar</b>, so you can also review an old version. Suggestions are drafts. An editor reviews every change before saving to Wikipedia.</p>
    </div>
  );

  return (
    <div>
      <div className="tabs">
        <div className="tabs-l"><span className="tab sel"><Wand2 size={13} /> Editor studio</span></div>
        <div className="tabs-r">
          <a className="tab" href={`#machine/${id}/${at ? isoDay(at) : "today"}`}><History size={13} /> Open in time machine</a>
          <a className="tab" href="#studio">Choose another article</a>
        </div>
      </div>
      <h1 className="firstHeading">{page ? page.title : <span className="skel-line skel-title" style={{ display: "inline-block", width: 240 }} />}</h1>
      <div className="siteSub">Editor studio · the version as it stood on <b>{at ? fmtDate(at) : "1 October 2026 (latest)"}</b>
        {view?.meta && <> · saved by {view.meta.user} · <a href={WIKI + view.meta.rev_id} target="_blank" rel="noopener">open on Wikipedia <ExternalLink size={11} /></a></>}
      </div>
      {!view ? <><Spinner label="Opening the article in the studio…" /><Skeleton lines={10} /></>
        : view.error ? <p className="muted">{view.error}</p>
        : <Studio page={page} view={view} />}
    </div>
  );
}
