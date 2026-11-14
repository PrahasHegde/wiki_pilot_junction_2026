// Shared helpers: API, formatting, Wikipedia links, markdown with citations.
export const api = async (url, opts) => {
  const r = await fetch(url, opts);
  return r.json();
};

export const START = Date.UTC(2003, 0, 1);
export const END = Date.UTC(2026, 9, 1);
export const YEAR_MS = 31557600000;
export const WIKI = "https://fi.wikipedia.org/w/index.php?oldid=";
export const DIFF = (a, b) => `https://fi.wikipedia.org/w/index.php?diff=${b}&oldid=${a}`;

// Server datetimes are naive UTC ("2012-04-23T08:12:33"): parse them as UTC.
export const utc = (d) => (d == null ? NaN : typeof d === "number" ? d : Date.parse(/Z|[+-]\d\d:?\d\d$/.test(d) ? d : d + "Z"));
const opt = (o) => ({ ...o, timeZone: "UTC" });
export const fmtDate = (d) => new Date(utc(d)).toLocaleDateString("en-GB", opt({ day: "numeric", month: "long", year: "numeric" }));
export const fmtShort = (d) => (d ? new Date(utc(d)).toLocaleDateString("en-GB", opt({ day: "numeric", month: "short", year: "numeric" })) : "");
export const fmtTime = (d) => new Date(utc(d)).toLocaleTimeString("en-GB", opt({ hour: "2-digit", minute: "2-digit" }));
export const fmtMonth = (m) => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-GB", opt({ month: "long", year: "numeric" }));
export const nf = (n) => Math.round(+n || 0).toLocaleString("en-US");
export const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
export const monthTime = (m) => Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 1);
export const xOf = (t) => (t - START) / (END - START);

// Edit summaries are wikitext: [[Target|label]] -> label, /* section */ -> →section:
export const wtx = (s) => String(s ?? "").replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1").replace(/\/\*\s*(.*?)\s*\*\//g, "→$1:").trim();

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Model output -> HTML (escaped first). [n] citations become Wikipedia-style superscripts.
export function md(src, sources) {
  const byN = Object.fromEntries((sources || []).map((s) => [s.n, s]));
  let h = esc(src);
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>");
  h = h.replace(/\s?\[(\d+(?:\s*,\s*\d+)*)\]/g, (m, inner) =>
    inner.split(/\s*,\s*/).map((n) => {
      const s = byN[+n];
      return `<sup class="ref ${s && s.era === "then" ? "then" : ""}" data-n="${+n}"><a>[${+n}]</a></sup>`;
    }).join(""));
  const isLi = (l) => /^\s*([-*•]|\d+\.)\s+/.test(l);
  return h.split(/\n{2,}/).map((b) => {
    const out = [];
    let run = [], list = null;
    const flush = () => {
      if (run.length) out.push(list
        ? "<ul>" + run.map((l) => "<li>" + l.replace(/^\s*([-*•]|\d+\.)\s+/, "") + "</li>").join("") + "</ul>"
        : "<p>" + run.map((l) => l.replace(/^#+\s*/, "")).join("<br>") + "</p>");
      run = [];
    };
    for (const l of b.split("\n")) {
      if (!l.trim()) continue;
      const li = isLi(l);
      if (list !== null && li !== list) flush();
      list = li;
      run.push(l);
    }
    flush();
    return out.join("");
  }).join("");
}

export const splitSentences = (t) => t.split(/(?<=[.!?])\s+(?=[A-ZÅÄÖ0-9"“])/);

export const looksLikeQuestion = (q) =>
  /\?|^(who|what|when|why|how|which|did|was|is|are|were|mitä|kuka|miksi|miten|milloin|mikä)\b/i.test(q) || q.trim().split(/\s+/).length > 4;
