// Edit-war analysis drawer: what was fought over, and how each side portrayed the subject.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, ExternalLink, History, Scale, Swords, X, Sparkles } from "lucide-react";
import { DIFF, api, fmtDate, fmtMonth, nf } from "../lib";
import { Globe, Hood } from "../components/ui";

const PORTRAYAL = {
  hero: ["Hero", "🦸"], villain: ["Villain", "🦹"], victim: ["Victim", "🫥"], neutral: ["Neutral", "⚖️"], mixed: ["Mixed", "🌗"],
};
const SIDE = { reverted: ["Reverted edits", "The version that was undone"], reverters: ["Reverters", "The version that was restored"] };

function Sentiment({ value }) {
  const pos = { negative: 0, neutral: 50, positive: 100 }[value] ?? 50;
  return (
    <div className="senti" title={`Sentiment: ${value}`}>
      <div className="senti-bar"><i style={{ left: `${pos}%` }} /></div>
      <div className="senti-lbl"><span>negative</span><span>neutral</span><span>positive</span></div>
    </div>
  );
}

export default function WarPanel({ war, onClose }) {
  const [r, setR] = useState(null);
  useEffect(() => {
    setR(null);
    let live = true;
    api(`/api/war/${war.page_id}/${war.month}`).then((x) => live && setR(x)).catch(() => live && setR({ error: "Could not reach the server." }));
    const esc = (e) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => { live = false; removeEventListener("keydown", esc); };
  }, [war.page_id, war.month, onClose]);
  const a = r?.analysis;
  const sides = a ? ["reverted", "reverters"].map((k) => a.sides.find((s) => s.side === k)).filter(Boolean) : [];

  return (
    <motion.div className="drawer-bg" onMouseDown={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.aside className="drawer" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Edit war analysis"
        initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 60, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 30 }}>
        <div className="drawer-head">
          <div>
            <div className="drawer-eyebrow"><Swords size={13} /> Edit war analysis</div>
            <h2>{war.title}</h2>
            <div className="muted">{fmtMonth(war.month)}{war.war_reverts ? ` · ${war.war_reverts} reverts between named editors` : ""}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {!r ? (
          <div className="drawer-loading"><Globe size={34} /><b>Reading the edit war…</b>
            <span>Finding every revert in system-versioned history, diffing the versions, and asking Gemini how each side portrayed the subject.</span></div>
        ) : r.error ? <p className="err">{r.error}</p> : (
          <>
            <motion.div className="war-headline" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>{a.headline}</motion.div>
            <div className="chips left tight-chips">
              <span className="pill mode">{a.dispute_type}</span>
              <span className="pill">subject: {a.subject}</span>
              <span className="pill">{nf(r.reverts)} reverts · {r.disputes.length} contested passages</span>
            </div>
            <p className="war-summary">{a.summary}</p>

            <div className="sides">
              {sides.map((s, i) => {
                const [label, emoji] = PORTRAYAL[s.portrayal] || PORTRAYAL.mixed;
                const editors = s.side === "reverted" ? r.reverted_editors : r.reverters;
                return (
                  <motion.div key={s.side} className={"side " + s.side} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * i }}>
                    <div className="side-top"><b>{SIDE[s.side][0]}</b><span className="muted small">{SIDE[s.side][1]}</span></div>
                    <div className={"portrayal " + s.portrayal}><span className="emo">{emoji}</span> portrays the subject as <b>{label.toLowerCase()}</b></div>
                    <Sentiment value={s.sentiment} />
                    <div className="tone">{s.tone_words.map((w) => <span key={w}>{w}</span>)}</div>
                    <p className="wanted">{s.wanted}</p>
                    {s.example_fi && <blockquote><span className="fi">“{s.example_fi}”</span><span className="enq">“{s.example_en}”</span></blockquote>}
                    <div className="editors">{editors.slice(0, 6).join(", ")}{editors.length > 6 ? ` +${editors.length - 6}` : ""}</div>
                  </motion.div>
                );
              })}
            </div>

            {a.changes?.length > 0 && <>
              <h4 className="drawer-h">What changed</h4>
              <ul className="war-changes">{a.changes.map((c, i) => (
                <li key={i}><div className="wc-what">{c.what_changed}</div>
                  <div className="wc-row"><del>{c.before_en}</del><ArrowRight size={14} /><ins>{c.after_en}</ins></div></li>
              ))}</ul>
            </>}

            <div className="verdicts">
              <div><h4 className="drawer-h"><History size={13} /> Outcome today</h4><p>{a.outcome}</p></div>
              <div><h4 className="drawer-h"><Scale size={13} /> Neutral point of view</h4><p>{a.npov_verdict}</p></div>
            </div>

            <details className="evidence"><summary>The contested wording (Finnish, from the database)</summary>
              {r.disputes.map((d, i) => (
                <div className="ev" key={i}>
                  <div className="ev-meta">{fmtDate(d.ts)} · {d.undone_user}'s edit undone by {d.reverted_by} · <a href={DIFF(d.undone_rev, d.rev_id)} target="_blank" rel="noopener">diff on Wikipedia <ExternalLink size={11} /></a></div>
                  {d.reverted && <div className="ev-r"><span className="tag rv">undone</span> {d.reverted} {d.reverted_today && <span className="tag">still on Wikipedia</span>}</div>}
                  {d.restored && <div className="ev-k"><span className="tag">restored</span> {d.restored} {d.restored_today && <span className="tag">still on Wikipedia</span>}</div>}
                </div>
              ))}
            </details>

            <div className="row drawer-actions">
              <a className="btn primary" href={`#machine/${war.page_id}/${war.month}-28/history`}><History size={14} /> See it in the time machine</a>
              <span className="fine"><Sparkles size={11} /> AI analysis of the diffs ({r.cached ? "cached" : "fresh"}). Check the contested wording above.</span>
            </div>
            <Hood items={r.trace} title="Under the hood: SQL + Gemini steps" />
          </>
        )}
      </motion.aside>
    </motion.div>
  );
}
