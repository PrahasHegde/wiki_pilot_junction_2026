import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { api, nf } from "../lib";
import { Hood, Skeleton, Spinner } from "../components/ui";
import { SearchBox } from "../components/shell";
import { useApp } from "../store";

const L = { fi: ["Suomi", "Finnish"], sv: ["Svenska", "Swedish"], en: ["English", "English"] };
const EX = ["Talvisota", "Suomen sisällissota", "Lapuanliike", "Carl Gustaf Emil Mannerheim", "Urho Kekkonen"];

export default function Lens() {
  const { route, go } = useApp();
  const id = route.a ? +route.a : null;
  const [page, setPage] = useState(null);
  const [r, setR] = useState(null);
  const [chips, setChips] = useState([]);
  useEffect(() => { Promise.all(EX.map((t) => api(`/api/pages?q=${encodeURIComponent(t)}`).then((x) => x[0]))).then((x) => setChips(x.filter(Boolean))); }, []);
  useEffect(() => {
    if (!id) return;
    setR(null); setPage(null);
    api(`/api/page/${id}`).then(setPage);
    api(`/api/lens/${id}`).then(setR);
  }, [id]);
  const a = r?.analysis;
  return (
    <div>
      <h1 className="firstHeading">Language lens</h1>
      <div className="siteSub">Finnish, Swedish and English Wikipedia tell the history of Finland differently. Pick a topic to line them up.</div>
      <SearchBox key={id} className="ask-box" placeholder="Find a topic: Talvisota, Lapuanliike, Mannerheim…" onPage={(p) => go(`lens/${p.page_id}`)} />
      <div className="chips left">{chips.map((c) => <button key={c.page_id} className={"chip" + (c.page_id === id ? " on" : "")} onClick={() => go(`lens/${c.page_id}`)}>{c.title}</button>)}</div>
      {id && !r && <div style={{ marginTop: 20 }}><Spinner label={`Reading “${page?.title || "…"}” in Finnish, Swedish and English and comparing them…`} /><Skeleton lines={8} /></div>}
      {r?.error && <p>{r.error}</p>}
      {r && !r.error && <>
        <div className="interlang">
          {["fi", "sv", "en"].map((l, i) => r.versions[l] ? (
            <motion.div key={l} className="lang" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
              <div className="code">{L[l][0]} · {L[l][1]}</div>
              <a href={r.versions[l].url} target="_blank" rel="noopener">{r.versions[l].title} <ExternalLink size={12} /></a>
              <div className="muted small">{nf(r.versions[l].chars)} characters</div>
            </motion.div>
          ) : (
            <div key={l} className="lang missing"><div className="code">{L[l][0]} · {L[l][1]}</div><b>No article on this topic</b>
              <div className="muted small">Closest by meaning: {(r.nearest[l] || []).slice(0, 2).map((n, j) => <span key={n.page_id}>{j > 0 && ", "}<a href={n.url} target="_blank" rel="noopener">{n.title}</a></span>)}</div></div>
          ))}
        </div>
        {a ? <>
          <motion.div className="lens-sum" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{a.summary}</motion.div>
          <div className="table-wrap">
            <table className="wikitable lens-tbl">
              <thead><tr><th style={{ width: "22%" }}>Point</th><th>Finnish</th><th>Swedish</th><th>English</th></tr></thead>
              <tbody>{a.differences.map((d, i) => (
                <tr key={i}>
                  <td className="topic"><b>{d.topic}</b><span className={"kind " + d.kind}>{d.kind}</span><div className="note">{d.note}</div></td>
                  {["fi", "sv", "en"].map((l) => <td key={l} className={(d[l] || "—").trim() === "—" ? "absent" : ""}>{d[l] || "—"}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="mw-body"><h2>For editors</h2><ul>{a.editor_suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
        </> : <p className="hatnote">Only the Finnish article exists for this topic. The closest articles in other languages are listed below.</p>}
        <div className="near">{["fi", "sv", "en"].map((l) => (
          <div className="card" key={l}><h3>Related · {L[l][1]}</h3><div className="muted small">bge-m3 vector index, across languages</div>
            <ol>{(r.nearest[l] || []).map((n) => <li key={n.page_id}><a href={n.url} target="_blank" rel="noopener">{n.title}</a> <small className="muted">{(1 - n.distance).toFixed(2)}</small></li>)}</ol></div>
        ))}</div>
        <Hood items={r.trace} />
      </>}
    </div>
  );
}
