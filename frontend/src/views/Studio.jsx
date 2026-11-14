// Editor studio: Gemini helps a Wikipedia editor improve a paragraph and illustrate it.
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Download, ImagePlus, Languages, Scale, ScissorsLineDashed, Sparkles, Upload, Wand2, BookMarked, Info } from "lucide-react";
import { Globe } from "../components/ui";

const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

// Word-level diff (LCS) for the "before → after" view.
function wordDiff(a, b) {
  const A = a.split(/\s+/).filter(Boolean), B = b.split(/\s+/).filter(Boolean);
  const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push(["=", A[i]]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push(["-", A[i++]]);
    else out.push(["+", B[j++]]);
  }
  while (i < n) out.push(["-", A[i++]]);
  while (j < m) out.push(["+", B[j++]]);
  return out;
}

const TASKS = [
  ["npov", "Neutrality (NPOV)", Scale, "Loaded wording, unattributed opinions, one-sided framing"],
  ["citations", "Citations needed", BookMarked, "Tag claims that need a source with {{lähde?}}"],
  ["clarity", "Clarity", Sparkles, "Shorter sentences and a clearer flow, same facts"],
  ["shorten", "Shorten", ScissorsLineDashed, "Condense to about half, for a summary or lead"],
];
const STYLES = [["watercolour", "Watercolour"], ["map", "Historical map"], ["diagram", "Diagram"], ["line", "Ink drawing"], ["poster", "Period poster"]];

export default function Studio({ page, view }) {
  const blocks = view?.blocks || [];
  const paras = blocks.map(([k, t], i) => ({ k, t, i })).filter((b) => (b.k === "p" || b.k === "li") && b.t.length > 60);
  const [sel, setSel] = useState(null);
  const [tool, setTool] = useState("improve");
  const para = sel != null ? blocks[sel]?.[1] : "";

  return (
    <div className="studio">
      <div className="studio-article mw-body">
        <div className="studio-hint"><Wand2 size={15} /> Pick a paragraph, then improve it or illustrate it with Gemini.</div>
        {blocks.map(([k, t], i) => k === "h" ? <h2 key={i}>{t}</h2> : k === "h3" ? <h3 key={i}>{t}</h3> : (
          <p key={i} className={"pick" + (sel === i ? " on" : "") + (t.length <= 60 ? " small" : "")} onClick={() => t.length > 60 && setSel(i)}>{t}</p>
        ))}
      </div>
      <aside className="studio-panel">
        <div className="seg">
          <button className={tool === "improve" ? "on" : ""} onClick={() => setTool("improve")}><Wand2 size={14} /> Improve text</button>
          <button className={tool === "image" ? "on" : ""} onClick={() => setTool("image")}><ImagePlus size={14} /> Illustrate</button>
        </div>
        {!para ? (
          <div className="studio-empty">
            <Wand2 size={28} />
            <b>Select a paragraph</b>
            <span>Click any paragraph of “{page?.title}” on the left. {paras.length} paragraphs in this version.</span>
            {paras[0] && <button className="btn" onClick={() => setSel(paras[0].i)}>Start with the introduction</button>}
          </div>
        ) : tool === "improve" ? <Improve key={sel} title={page?.title} text={para} /> : <Illustrate key={"img"} title={page?.title} text={para} />}
      </aside>
    </div>
  );
}

function Improve({ title, text }) {
  const [task, setTask] = useState(null);
  const [res, setRes] = useState(null);
  const [copied, setCopied] = useState(false);
  const run = async (t) => { setTask(t); setRes({ loading: true }); setRes(await post("/api/studio/improve", { title, text, task: t })); };
  const diff = res?.rewrite ? wordDiff(text, res.rewrite) : null;
  return (
    <div>
      <div className="quote small-quote">{text.length > 280 ? text.slice(0, 280) + "…" : text}</div>
      <div className="task-grid">
        {TASKS.map(([k, label, Icon, hint]) => (
          <button key={k} className={"task" + (task === k ? " on" : "")} onClick={() => run(k)} disabled={res?.loading}>
            <Icon size={16} /><b>{label}</b><span>{hint}</span>
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        {res?.loading && <motion.div key="l" className="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Globe size={20} />Gemini is reviewing the paragraph against Wikipedia's policies…</motion.div>}
        {res && !res.loading && (
          <motion.div key="r" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <div className="story">{res.summary}</div>
            {res.issues?.length > 0 && (
              <ul className="issues">{res.issues.map((x, i) => (
                <li key={i}><span className={"kind " + (x.type === "npov" || x.type === "weasel" ? "framing" : x.type === "unsourced" ? "factual" : "omission")}>{x.type}</span>
                  <q>{x.quote}</q> {x.explanation}</li>
              ))}</ul>
            )}
            <h4>Suggested edit</h4>
            <div className="sdiff">{diff.map(([op, w], i) => op === "=" ? <span key={i}>{w} </span> : op === "-" ? <del key={i}>{w}</del> : <ins key={i}>{w}</ins>)}</div>
            <details className="en"><summary><Languages size={13} /> In English</summary><p>{res.rewrite_en}</p></details>
            <div className="row">
              <button className="btn primary" onClick={() => { navigator.clipboard?.writeText(res.rewrite); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy wikitext</>}</button>
              <span className="fine">{res.model} · {(res.ms / 1000).toFixed(1)} s · always review before saving to Wikipedia</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Illustrate({ title, text }) {
  const [style, setStyle] = useState("watercolour");
  const [prompt, setPrompt] = useState("");
  const [edit, setEdit] = useState("");
  const [busy, setBusy] = useState(null); // "prompt" | "image" | "edit"
  const [imgs, setImgs] = useState([]);   // [{image, mime, label}]
  const [cur, setCur] = useState(-1);
  const [err, setErr] = useState("");
  const file = useRef(null);
  const img = imgs[cur];

  const suggest = async () => { setBusy("prompt"); setErr(""); const r = await post("/api/studio/prompt", { title, text, style }); setPrompt(r.prompt || ""); setBusy(null); };
  const add = (r, label) => { if (r.error) { setErr(r.error); return; } setImgs((a) => { const n = [...a, { ...r, label }]; setCur(n.length - 1); return n; }); };
  const generate = async () => {
    let p = prompt; setErr("");
    if (!p) { setBusy("prompt"); p = (await post("/api/studio/prompt", { title, text, style })).prompt || ""; setPrompt(p); }
    setBusy("image"); add(await post("/api/studio/image", { prompt: p, style }), STYLES.find((s) => s[0] === style)[1]); setBusy(null);
  };
  const doEdit = async () => {
    if (!img || !edit.trim()) return;
    setBusy("edit"); setErr(""); add(await post("/api/studio/image", { prompt: edit, image: img.image, mime: img.mime }), "Edit: " + edit.slice(0, 30)); setEdit(""); setBusy(null);
  };
  const upload = (f) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { const [head, data] = String(r.result).split(","); add({ image: data, mime: head.slice(5).split(";")[0] }, "Uploaded"); };
    r.readAsDataURL(f);
  };

  return (
    <div>
      <div className="chips left tight-chips">{STYLES.map(([k, l]) => <button key={k} className={"chip" + (style === k ? " on" : "")} onClick={() => setStyle(k)}>{l}</button>)}</div>
      <div className="prompt-box">
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} placeholder="Describe the illustration — or let Gemini write the prompt from the selected paragraph." />
        <div className="row">
          <button className="btn" onClick={suggest} disabled={!!busy}><Sparkles size={14} /> Write prompt from paragraph</button>
          <button className="btn primary" onClick={generate} disabled={!!busy}><ImagePlus size={14} /> Generate</button>
          <button className="btn quiet" onClick={() => file.current.click()} title="Edit your own image"><Upload size={14} /> Upload image</button>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files[0])} />
        </div>
      </div>
      {busy && <div className="loading"><Globe size={20} />{busy === "prompt" ? "Gemini is writing a historically careful prompt…" : busy === "edit" ? "Gemini is editing the image…" : "Gemini is painting the illustration…"}</div>}
      {err && <p className="err">{err}</p>}
      {img && (
        <motion.figure className="gen" key={cur} initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }}>
          <img src={`data:${img.mime};base64,${img.image}`} alt="AI-generated illustration" />
          <figcaption><span className="ai-badge">AI-generated</span> {img.label}{img.ms ? ` · ${img.model} · ${(img.ms / 1000).toFixed(1)} s` : ""}</figcaption>
        </motion.figure>
      )}
      {img && (
        <div className="edit-box">
          <input value={edit} onChange={(e) => setEdit(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doEdit()} placeholder="Edit this image: “make it a winter dusk”, “add arrows for the Soviet advance”…" />
          <button className="btn primary" onClick={doEdit} disabled={!!busy || !edit.trim()}><Wand2 size={14} /> Edit</button>
          <a className="btn" href={`data:${img.mime};base64,${img.image}`} download={`wikipilot-${(title || "image").replace(/\W+/g, "-")}.${img.mime.split("/")[1] || "png"}`}><Download size={14} /></a>
        </div>
      )}
      {imgs.length > 1 && <div className="thumbs">{imgs.map((x, i) => <img key={i} className={i === cur ? "on" : ""} src={`data:${x.mime};base64,${x.image}`} title={x.label} onClick={() => setCur(i)} alt="" />)}</div>}
      <p className="commons"><Info size={13} /> Illustrations are AI-generated, not historical records. If you upload one to Wikimedia Commons, mark it as AI-generated and follow Commons' guideline on AI-generated media. Never present it as a photograph.</p>
    </div>
  );
}
