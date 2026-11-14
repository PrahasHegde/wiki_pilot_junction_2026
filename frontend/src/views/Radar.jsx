import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import WarPanel from "./WarPanel";
import { api, fmtMonth, nf } from "../lib";
import { Hood, Kpis, Skeleton } from "../components/ui";
import { useApp } from "../store";

export default function Radar() {
  const { go, route, sync } = useApp();
  const [r, setR] = useState(null);
  const [war, setWar] = useState(null);
  const open = (w) => { setWar(w); sync(`radar/${w.page_id}/${w.month}`); };
  const close = useCallback(() => { setWar(null); sync("radar"); }, [sync]);
  useEffect(() => {                     // deep link: #radar/<page_id>/<YYYY-MM>
    if (route.a && route.b && /^\d{4}-\d{2}$/.test(route.b)) {
      const w = r?.wars.find((x) => x.page_id === +route.a && x.month === route.b);
      setWar(w || { page_id: +route.a, month: route.b, title: "Edit war" });
    }
  }, [route.a, route.b, r]);
  const [st, setSt] = useState(null);
  useEffect(() => { api("/api/radar").then(setR); api("/api/stats").then(setSt); }, []);
  const tot = r ? r.years.reduce((a, y) => ({ e: a.e + +y.edits, r: a.r + +y.reverts, w: a.w + +y.war_reverts, an: a.an + +y.anon }), { e: 0, r: 0, w: 0, an: 0 }) : null;
  return (
    <div>
      <h1 className="firstHeading">Edit wars</h1>
      <div className="siteSub">Every revert in every version of every article, found by window functions over the system-versioned history.</div>
      <div className="hatnote">A <b>revert</b> restores an earlier text exactly (same SHA-1). Undoing an anonymous edit is usually <span className="k-v">vandalism cleanup</span>. Named editors undoing each other is an <span className="k-w">edit war</span>.</div>
      {!r || !st ? <Skeleton lines={10} /> : <>
        <Kpis items={[[nf(st.pages), "articles"], [nf(tot.e), "versions analysed"], [nf(tot.r), "reverts"], [nf(tot.w), "edit-war reverts"], [Math.round(100 * tot.an / tot.e) + "%", "edits by anonymous editors"]]} />
        <div className="two">
          <div className="card"><h3>Activity per year</h3><YearsChart years={r.years} /></div>
          <div className="card"><h3>Edit-war heat: most contested articles × year</h3><Heat r={r} go={go} /></div>
        </div>
        <div className="two">
          <div className="card"><h3>Most contested articles</h3><TopTable top={r.top} go={go} /></div>
          <div className="card"><h3>The fiercest edit wars</h3>
            <div className="war-tip"><Sparkles size={13} /> Click a war: Gemini explains what was fought over and how each side portrayed the subject.</div>
            <div className="wars">{r.wars.map((w, i) => (
              <motion.button key={w.page_id + w.month} className="war" onClick={() => open(w)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 12) * 0.03 }}>
                <div className="war-head"><span className="war-t">{w.title}</span><span className="war-n">{w.war_reverts} reverts</span></div>
                <small>{fmtMonth(w.month)} · {(w.reverters || "").slice(0, 90)} ⇄ {(w.reverted || "").slice(0, 90)}</small>
                <span className="war-why">Why they fought →</span>
              </motion.button>
            ))}</div>
          </div>
        </div>
        <Hood items={r.trace} />
      </>}
      <AnimatePresence>{war && <WarPanel key={war.page_id + war.month} war={war} onClose={close} />}</AnimatePresence>
    </div>
  );
}

function TopTable({ top, go }) {
  const maxW = Math.max(...top.map((t) => +t.war_reverts));
  return (
    <table className="wikitable full">
      <thead><tr><th>Article</th><th>Edits</th><th>Vandalism reverts</th><th>Edit-war reverts</th></tr></thead>
      <tbody>{top.slice(0, 18).map((t) => (
        <tr key={t.page_id} onClick={() => go(`machine/${t.page_id}`)}>
          <td><a>{t.title}</a></td><td className="num">{nf(t.edits)}</td><td className="num">{nf(t.vandalism_reverts)}</td>
          <td className="num">{nf(t.war_reverts)}<span className="minibar" style={{ width: 40 * t.war_reverts / maxW }} /></td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function Heat({ r, go }) {
  const ids = r.top.slice(0, 20).map((t) => t.page_id), title = Object.fromEntries(r.top.map((t) => [t.page_id, t.title]));
  const yrs = []; for (let y = 2004; y <= 2026; y++) yrs.push(y);
  const cell = {}; let mx = 1;
  r.heat.forEach((c) => { cell[c.page_id + ":" + c.year] = +c.war_reverts; mx = Math.max(mx, +c.war_reverts); });
  return (
    <div className="heat" style={{ gridTemplateColumns: `140px repeat(${yrs.length}, 1fr)` }}>
      {ids.map((id) => [
        <div key={id} className="lbl" onClick={() => go(`machine/${id}`)} title={title[id]}>{title[id]}</div>,
        ...yrs.map((y) => {
          const v = cell[id + ":" + y] || 0;
          return <div key={id + ":" + y} className="c" title={`${title[id]} ${y}: ${v} edit-war reverts`} onClick={() => v && go(`machine/${id}/${y}-07-01`)}
            style={{ background: v ? `color-mix(in srgb, var(--war) ${15 + 85 * Math.sqrt(v / mx)}%, var(--bg-sub))` : "var(--bg-sub)", cursor: v ? "pointer" : "default" }} />;
        }),
      ])}
      <div />{yrs.map((y) => <div key={"y" + y} className="yr">{y % 4 === 0 ? "'" + String(y).slice(2) : ""}</div>)}
    </div>
  );
}

function YearsChart({ years }) {
  const ref = useRef(null);
  const [W, setW] = useState(560);
  useEffect(() => { const ro = new ResizeObserver(([e]) => setW(e.contentRect.width || 560)); ro.observe(ref.current); return () => ro.disconnect(); }, []);
  const H = 220, pad = 20, ys = years.filter((y) => y.year >= 2003 && y.year <= 2026), max = Math.max(...ys.map((y) => +y.edits)), bw = W / ys.length, k = (H - pad - 16) / max;
  return (
    <svg ref={ref} className="chart" viewBox={`0 0 ${W} ${H}`}>
      {ys.map((y, i) => {
        const hN = (y.edits - y.anon) * k, hA = y.anon * k, x = i * bw + 2, hW = y.war_reverts * k * 4;
        return (
          <g key={y.year}><title>{`${y.year}: ${nf(y.edits)} edits (${nf(y.anon)} anonymous), ${nf(y.reverts)} reverts, ${nf(y.war_reverts)} edit-war reverts, ${nf(y.editors)} editors`}</title>
            <motion.rect x={x} width={bw - 4} fill="var(--bar)" initial={{ y: H - pad, height: 0 }} animate={{ y: H - pad - hN, height: hN }} transition={{ delay: i * 0.02 }} />
            <motion.rect x={x} width={bw - 4} fill="var(--vandal)" initial={{ y: H - pad, height: 0 }} animate={{ y: H - pad - hN - hA, height: hA }} transition={{ delay: i * 0.02 }} />
            <rect x={x + (bw - 4) / 3} y={H - pad - hW} width={(bw - 4) / 3} height={hW} fill="var(--war)" />
            {y.year % 2 === 0 && <text x={x + (bw - 4) / 2} y={H - 5} fontSize="10" textAnchor="middle" fill="var(--text-muted)">{y.year}</text>}
          </g>
        );
      })}
      <text x={W - 4} y="11" fontSize="10.5" textAnchor="end" fill="var(--text-muted)">■ named · ■ anonymous · <tspan fill="var(--war)">■ edit-war reverts ×4</tspan></text>
    </svg>
  );
}
