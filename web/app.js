/* WikiPilot — client. No framework: a handful of views over a small JSON/SSE API. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const api = async (url, opts) => { const r = await fetch(url, opts); return r.json(); };
const fmtDate = d => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmtShort = d => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
const fmtTime = d => new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const nf = n => Math.round(+n || 0).toLocaleString("en-US");
const WIKI = "https://fi.wikipedia.org/w/index.php?oldid=";
const DIFF = (a, b) => `https://fi.wikipedia.org/w/index.php?diff=${b}&oldid=${a}`;
// Edit summaries are wikitext: [[Target|label]] -> label, /* section */ -> section ›
const wtx = s => String(s ?? "").replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1").replace(/\/\*\s*(.*?)\s*\*\//g, "→$1:").trim();
const yearsAgo = d => ((Date.now() - Date.parse(d)) / 31557600000);

/* ------------------------------------------------------------------ theme + menu */
try { const t = new URLSearchParams(location.search).get("theme") || localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
$("#theme").onclick = () => {
  const dark = getComputedStyle(document.documentElement).colorScheme === "dark";
  document.documentElement.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("theme", document.documentElement.dataset.theme); } catch (e) {}
  drawStrata(); if (state.timeline) { drawTimeline(state.timeline); drawSpark($("#ibSpark"), state.timeline.months); }
};
$("#hamburger").onclick = () => {
  const p = $(".page");
  if (innerWidth <= 860) p.classList.toggle("nav-open"); else p.classList.toggle("nav-closed");
};

/* ------------------------------------------------------------------ state + routing */
const START = Date.UTC(2003, 0, 1), END = Date.UTC(2026, 9, 1);
const state = { at: null, tab: "home", page: null, timeline: null, activity: [], artReq: 0, mt: "read", histShown: 60,
                showAge: new URLSearchParams(location.search).has("age") };
const VIEWS = ["home", "ask", "machine", "radar", "lens", "how"];
function go(tab, push = true) {
  state.tab = tab;
  $$(".view").forEach(v => v.classList.toggle("on", v.id === "view-" + tab));
  $$(".sidebar a[data-tab]").forEach(a => a.classList.toggle("cur", a.dataset.tab === tab));
  if (tab === "radar" && !state.radarLoaded) loadRadar();
  if (tab === "how" && !state.howLoaded) loadHow();
  if (push && location.hash.split("/")[0] !== "#" + tab) history.replaceState(null, "", "#" + tab);
  $(".page").classList.remove("nav-open");
  scrollTo({ top: 0 });
}
$$(".sidebar a[data-tab]").forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.tab); });
$$(".mp-areas a, .mp-welcome a").forEach(a => a.onclick = e => { e.preventDefault(); go(a.getAttribute("href").slice(1)); });
$(".logo").onclick = e => { e.preventDefault(); go("home"); };

/* ------------------------------------------------------------------ time bar */
const track = $("#track"), handle = $("#handle");
function atISO() { return state.at ? new Date(state.at).toISOString().slice(0, 10) : null; }
function setAt(t, fire = true) {
  t = Math.max(START, Math.min(END, t));
  state.at = END - t < 86400000 * 5 ? null : t;
  handle.style.left = ((t - START) / (END - START) * 100) + "%";
  const label = state.at ? fmtDate(state.at) : "today";
  $("#when").textContent = label;
  $("#timepillText").textContent = state.at ? fmtShort(state.at) : "Today";
  $("#timepill").classList.toggle("past", !!state.at);
  $("#timebar").classList.toggle("past", !!state.at);
  $("#nowBtn").classList.toggle("hidden", !state.at);
  track.setAttribute("aria-valuetext", label);
  if (fire) onTimeChange();
}
let tcTimer;
function onTimeChange() {
  clearTimeout(tcTimer);
  tcTimer = setTimeout(() => {
    if (state.tab === "machine" && state.page) { loadArticle(); history.replaceState(null, "", `#machine/${state.page.page_id}/${atISO() || "today"}`); }
  }, 220);
}
const posToTime = x => { const r = track.getBoundingClientRect(); return START + (END - START) * Math.max(0, Math.min(1, (x - r.left) / r.width)); };
let dragging = false;
track.addEventListener("pointerdown", e => { dragging = true; track.setPointerCapture(e.pointerId); setAt(posToTime(e.clientX)); });
track.addEventListener("pointermove", e => { if (dragging) setAt(posToTime(e.clientX)); });
track.addEventListener("pointerup", () => dragging = false);
track.addEventListener("keydown", e => {
  const step = { ArrowLeft: -30, ArrowRight: 30, PageDown: -365, PageUp: 365 }[e.key]; if (!step) return;
  e.preventDefault(); setAt((state.at || END) + step * 86400000);
});
$("#timepill").onclick = () => track.focus();
let playTimer = null;
function stopPlay() { clearInterval(playTimer); playTimer = null; $("#playBtn").classList.remove("on"); $("#playBtn").textContent = "▶ Play history"; }
$("#nowBtn").onclick = () => { stopPlay(); setAt(END); };
$("#playBtn").onclick = () => {
  if (playTimer) return stopPlay();
  let t = state.at && state.at < END - 86400000 * 200 ? state.at :
    (state.tab === "machine" && state.page ? Date.parse(state.page.first_edit) + 86400000 * 120 : Date.UTC(2005, 0, 1));
  $("#playBtn").classList.add("on"); $("#playBtn").textContent = "❚❚ Pause";
  setAt(t);
  playTimer = setInterval(() => { t += 86400000 * 182; if (t >= END) { setAt(END); return stopPlay(); } setAt(t); }, 1600);
};
function drawYears() {
  $("#years").innerHTML = "";
  for (let y = 2004; y <= 2026; y += 2)
    $("#years").insertAdjacentHTML("beforeend", `<span style="left:${(Date.UTC(y, 0, 1) - START) / (END - START) * 100}%">${y}</span>`);
}
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function drawStrata() {
  const c = $("#strata"), dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext("2d"); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  const a = state.activity; if (!a.length) return;
  const max = Math.max(...a.map(d => d.edits)), bw = w / 285;
  for (const d of a) {
    const t = Date.UTC(+d.month.slice(0, 4), +d.month.slice(5, 7) - 1, 1); if (t < START || t > END) continue;
    const x = (t - START) / (END - START) * w, v = Math.sqrt(d.edits / max);
    g.globalAlpha = .35 + .55 * v; g.fillStyle = cssVar("--bar"); g.fillRect(x, h - v * (h - 2), Math.max(1, bw - .6), v * (h - 2));
    if (d.war_reverts > 0) { g.globalAlpha = Math.min(1, .25 + d.war_reverts / 40); g.fillStyle = cssVar("--war"); g.fillRect(x, 0, Math.max(1, bw - .6), 3); }
  }
  g.globalAlpha = 1;
}
addEventListener("resize", () => { drawStrata(); if (state.timeline) drawTimeline(state.timeline); });

/* ------------------------------------------------------------------ header search */
function suggestBox(input, box, { onPick, allowAsk = false }) {
  let t, sel = -1, rows = [];
  const render = () => {
    const q = input.value.trim();
    box.innerHTML = rows.map((r, i) => `<div class="opt${i === sel ? " sel" : ""}" data-i="${i}"><b>${esc(r.title)}</b><small>${nf(r.versions)} versions${r.deep ? " · full history" : ""}</small></div>`).join("")
      + (allowAsk && q.length > 2 ? `<div class="opt ask-opt${sel === rows.length ? " sel" : ""}" data-i="${rows.length}">Ask Wikipedia: “${esc(q)}”${state.at ? ` (as of ${fmtShort(state.at)})` : ""}</div>` : "");
    $$(".opt", box).forEach(o => o.onmousedown = e => { e.preventDefault(); choose(+o.dataset.i); });
  };
  const choose = i => {
    const q = input.value.trim(); box.innerHTML = "";
    if (i < rows.length && rows[i]) { input.value = allowAsk ? "" : rows[i].title; onPick({ page: rows[i] }); }
    else if (allowAsk && q) { input.value = ""; onPick({ ask: q }); }
  };
  input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(async () => {
    const q = input.value.trim(); if (!q) { rows = []; box.innerHTML = ""; return; }
    rows = (await api(`/api/pages?q=${encodeURIComponent(q)}`)).slice(0, 7); sel = -1; render();
  }, 140); });
  input.addEventListener("keydown", e => {
    const n = rows.length + (allowAsk && input.value.trim().length > 2 ? 1 : 0);
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && n) { e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + n) % n; render(); }
    if (e.key === "Enter") {
      e.preventDefault();
      const q = input.value.trim(), looksLikeQuestion = /\?|^(who|what|when|why|how|which|did|was|is|mitä|kuka|miksi|miten|milloin)\b/i.test(q) || q.split(/\s+/).length > 4;
      if (sel >= 0) choose(sel); else if (allowAsk && looksLikeQuestion) choose(rows.length); else if (rows.length) choose(0); else if (allowAsk) choose(rows.length);
    }
    if (e.key === "Escape") box.innerHTML = "";
  });
  input.addEventListener("blur", () => setTimeout(() => box.innerHTML = "", 150));
}
suggestBox($("#search"), $("#suggest"), { allowAsk: true, onPick: x => x.page ? openPage(x.page.page_id) : ask(x.ask) });
$("#searchForm").onsubmit = e => e.preventDefault();
addEventListener("keydown", e => { if (e.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $("#search").focus(); } });

/* ------------------------------------------------------------------ citations: markdown + hover previews */
function md(src, sources) {
  const byN = Object.fromEntries((sources || []).map(s => [s.n, s]));
  let h = esc(src);
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>");
  h = h.replace(/\s?\[(\d+(?:\s*,\s*\d+)*)\]/g, (m, inner) => inner.split(/\s*,\s*/).map(n => {
    const s = byN[+n]; return `<sup class="ref ${s && s.era === "then" ? "then" : ""}" data-n="${+n}"><a>[${+n}]</a></sup>`;
  }).join(""));
  // Line by line: runs of list items become <ul>, other runs become paragraphs (a heading line
  // directly followed by bullets is common in model output).
  const isLi = l => /^\s*([-*•]|\d+\.)\s+/.test(l);
  return h.split(/\n{2,}/).map(b => {
    const out = []; let run = [], list = null;
    const flush = () => { if (run.length) out.push(list ? "<ul>" + run.map(l => "<li>" + l.replace(/^\s*([-*•]|\d+\.)\s+/, "") + "</li>").join("") + "</ul>"
                                                         : "<p>" + run.map(l => l.replace(/^#+\s*/, "")).join("<br>") + "</p>"); run = []; };
    for (const l of b.split("\n")) { if (!l.trim()) continue; const li = isLi(l); if (list !== null && li !== list) flush(); list = li; run.push(l); }
    flush(); return out.join("");
  }).join("");
}
const pop = $("#pop");
function showPop(el, html) {
  pop.innerHTML = html; pop.classList.remove("hidden");
  const r = el.getBoundingClientRect();
  pop.style.left = Math.min(innerWidth - 376, Math.max(8, r.left - 30)) + "px";
  pop.style.top = (r.bottom + 8 + pop.offsetHeight > innerHeight ? r.top - pop.offsetHeight - 8 : r.bottom + 8) + "px";
}
document.addEventListener("mouseover", e => {
  const c = e.target.closest("sup.ref"); if (!c) { pop.classList.add("hidden"); return; }
  const s = (state.sources || []).find(s => s.n === +c.dataset.n); if (!s) return;
  showPop(c, `<div class="pop-t">${esc(s.title)}</div><div class="pop-m">${esc(s.section || "Introduction")} · ${eraText(s)}</div><div class="pop-x">${esc(s.text.slice(0, 340))}${s.text.length > 340 ? "…" : ""}</div>`);
});
document.addEventListener("click", e => {
  const c = e.target.closest("sup.ref"); if (!c) return;
  const li = $(`#ref-${c.dataset.n}`); if (!li) return;
  li.scrollIntoView({ behavior: "smooth", block: "center" }); li.classList.add("flash", "open"); setTimeout(() => li.classList.remove("flash"), 1500);
});
const eraText = s => ({ then: "Wikipedia then", now: "Wikipedia today", asof: "Wikipedia as of " + $("#when").textContent }[s.era] || `Wikipedia in ${s.era}`)
  + (s.version_saved ? `, version of ${fmtShort(s.version_saved)}` : "");

/* ------------------------------------------------------------------ ASK */
const EXAMPLES = [
  { q: "What did Wikipedia say about the 1918 prison camps in 2008, and what has changed since?", t: "then vs now" },
  { q: "How has Wikipedia's account of who started the Winter War changed over the years?", t: "drift" },
  { q: "Who led the Finnish armed forces in the Winter War?", t: "now" },
  { q: "Mitä Wikipedia kertoi Lapuanliikkeestä vuonna 2007?", t: "as of 2007" },
  { q: "How did Finland's NATO membership come about?", t: "now" },
];
const chipHTML = (e, i) => `<button class="chip" data-i="${i}"><b>${e.t}</b>${esc(e.q)}</button>`;
$("#examples").innerHTML = EXAMPLES.map(chipHTML).join("");
$("#mpChips").innerHTML = EXAMPLES.slice(0, 3).map(chipHTML).join("");
$$("#examples .chip, #mpChips .chip").forEach(b => b.onclick = () => ask(EXAMPLES[b.dataset.i].q));
$("#askForm").onsubmit = e => { e.preventDefault(); ask($("#q").value); };
$("#mpAsk").onsubmit = e => { e.preventDefault(); ask($("#mpQ").value); };
$("#navTry").innerHTML = EXAMPLES.slice(0, 2).map((e, i) => `<li><a data-i="${i}">${esc(e.t === "drift" ? "How the Winter War story drifted" : "Prison camps: 2008 vs now")}</a></li>`).join("")
  + `<li><a data-page="Talvisota">Talvisota through time</a></li><li><a data-lens="Talvisota">Winter War in 3 languages</a></li>`;
$$("#navTry a[data-i]").forEach(a => a.onclick = () => ask(EXAMPLES[a.dataset.i].q));

let es;
function ask(q) {
  q = (q || "").trim(); if (!q) return;
  go("ask", false); history.replaceState(null, "", "#ask/" + encodeURIComponent(q) + (atISO() ? "/" + atISO() : ""));
  $("#q").value = q;
  if (es) es.close();
  $("#answerArea").classList.remove("hidden");
  $("#hatnote").textContent = "";
  $("#plan").innerHTML = `<span class="spin"></span>Reading the question for time…`;
  $("#answer").innerHTML = `<div class="loading"><span class="spin"></span>Searching Wikipedia's past…</div>`;
  $("#sources").innerHTML = ""; $("#askTrace").innerHTML = ""; state.sources = [];
  let text = "", raf = 0;
  es = new EventSource(`/api/ask?q=${encodeURIComponent(q)}` + (atISO() ? `&date=${atISO()}` : ""));
  es.addEventListener("plan", e => renderPlan(JSON.parse(e.data)));
  es.addEventListener("sources", e => { state.sources = JSON.parse(e.data); renderSources(state.sources); $("#answer").innerHTML = `<div class="loading"><span class="spin"></span>Writing an answer from these ${state.sources.length} passages only…</div>`; });
  es.addEventListener("token", e => {
    text += JSON.parse(e.data);
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; $("#answer").innerHTML = md(text, state.sources); $("#answer").lastElementChild?.classList.add("cursor"); });
  });
  es.addEventListener("drift", e => renderDrift(JSON.parse(e.data)));
  es.addEventListener("trace", e => renderTrace($("#askTrace"), JSON.parse(e.data)));
  es.addEventListener("error", e => { if (e.data) $("#answer").innerHTML = `<p style="color:var(--red)">${esc(JSON.parse(e.data))}</p>`; });
  es.addEventListener("done", () => { es.close(); cancelAnimationFrame(raf); if (text) $("#answer").innerHTML = md(text, state.sources); });
}
function renderPlan(p) {
  const modes = { now: "Today's Wikipedia", asof: "As of " + (p.date ? fmtDate(p.date) : ""), compare: `Then (${(p.date || "").slice(0, 4)}) vs now`, drift: "Drift, 2005 → today" };
  $("#hatnote").innerHTML = {
    now: "This answer reflects Wikipedia <b>as it stands today</b>. Drag the time bar to ask the past.",
    asof: `This answer reflects Wikipedia <b>as it stood on ${p.date ? fmtDate(p.date) : "that date"}</b>, not as it is today.`,
    compare: `This answer compares Wikipedia <b>as of ${p.date ? fmtDate(p.date) : "then"}</b> with Wikipedia <b>today</b>. Green citations are from then.`,
    drift: "This answer traces how Wikipedia's account <b>changed between 2005 and today</b>, era by era.",
  }[p.mode] || "";
  $("#plan").innerHTML = `<span class="pill mode">${esc(modes[p.mode] || p.mode)}</span><span>searched for</span><span class="pill">“${esc(p.search_fi)}”</span>${(p.keywords_fi || []).map(k => `<span class="pill">${esc(k)}</span>`).join("")}`;
}
function lifeHTML(s) {
  const since = s.since ? Date.parse(s.since) : null, until = s.until ? Date.parse(s.until) : null; if (!since) return "";
  const a = (since - START) / (END - START), b = ((until || END) - START) / (END - START), age = yearsAgo(s.since);
  const badge = until ? `<span class="badge removed">since removed</span>` : age >= 5 ? `<span class="badge stable">stable ${Math.floor(age)} y</span>` : age < 1 ? `<span class="badge fresh">new</span>` : "";
  return `<span class="life" title="When this passage was on Wikipedia"><span class="lifebar"><i class="${until ? "gone" : ""}" style="left:${a * 100}%;width:${Math.max(2, (b - a) * 100)}%"></i></span>
    ${until ? `${new Date(since).getUTCFullYear()}–${new Date(until).getUTCFullYear()}` : `since ${new Date(since).getUTCFullYear()}`}</span>${badge}`;
}
function renderSources(srcs) {
  $("#sources").innerHTML = srcs.map(s => `<li id="ref-${s.n}">
      <span class="ref-title">“${esc(s.title)}”</span> <span class="ref-sec">§ ${esc(s.section || "Introduction")}</span>
      <div class="ref-text" onclick="this.parentNode.classList.toggle('open')">${esc(s.text)}</div>
      <div class="ref-meta"><span class="era ${["then", "now", "asof"].includes(s.era) ? s.era : "then"}">${esc(s.era === "asof" ? "as of" : s.era)}</span>${lifeHTML(s)}
        <a href="${WIKI}${s.oldid}" target="_blank" rel="noopener">version of ${fmtShort(s.version_saved)} ↗</a>
        <a onclick="openPage(${s.page_id}, '${(s.version_saved || "").slice(0, 10)}')">time machine →</a></div></li>`).join("")
    || "<li>No passages were found at that moment in time.</li>";
}
function renderDrift(d) {
  $("#answer").innerHTML = (d.eras || []).map(e => `<div class="drift-era ${e.changed ? "changed" : ""}">
      <h3>${esc(e.year === "now" ? "Today" : e.year)}${e.changed && e.change ? `<span class="drift-change">${esc(e.change)}</span>` : ""}</h3>${md(e.answer, state.sources)}</div>`).join("")
    + `<div class="drift-summary"><strong>How the story changed.</strong> ${md(d.summary || "", state.sources)}</div>`;
}
const SQLKW = /\b(WITH|SELECT|FROM|WHERE|JOIN|USING|ORDER BY|GROUP BY|LIMIT|AS OF|FOR SYSTEM_TIME|ALL|TIMESTAMP|UNION ALL|OVER|PARTITION BY|WINDOW|MATCH|AGAINST|IN BOOLEAN MODE|VEC_DISTANCE_COSINE|VEC_FromText|LOCATE|LAG|ROW_NUMBER|COALESCE|LEFT JOIN|HAVING|SUM|COUNT|MIN|MAX)\b/g;
function renderTrace(el, items) {
  const total = items.reduce((a, i) => a + i.ms, 0);
  el.innerHTML = items.map(i => `<div class="tq"><div class="tq-head"><span>${esc(i.label)}</span><span class="tq-ms">${i.ms} ms${i.rows != null ? ` · ${i.rows} rows` : ""}</span></div>${i.sql ? `<pre>${esc(i.sql).replace(SQLKW, '<span class="kw">$1</span>')}</pre>` : ""}</div>`).join("")
    + `<div style="font-size:12px;color:var(--text-muted)">Total ${nf(total)} ms</div>`;
}

/* ------------------------------------------------------------------ MAIN PAGE */
async function loadHome() {
  const [h, st] = await Promise.all([api("/api/home"), api("/api/stats")]);
  $("#mpCount").innerHTML = `<b>${nf(st.versions)}</b> versions of <b>${nf(st.pages)}</b> articles · <b>${nf(st.passage_rows)}</b> passages through time · 2003 – 2026`;
  $("#navStats").innerHTML = `<li><b>${nf(st.versions)}</b> versions</li><li><b>${nf(st.pages)}</b> articles</li><li><b>${nf(st.passage_rows)}</b> passages with vectors</li><li><b>${nf(st.articles_now)}</b> articles in fi · sv · en</li><li><b>${nf(st.s3_tables)}</b> tables in S3</li>`;
  const f = h.featured;
  if (f) {
    $("#mpFeatured").innerHTML = `<div class="feat-spark"><svg id="featSpark"></svg><div>${nf(f.versions)} versions, ${new Date(f.first_edit).getUTCFullYear()}–2026</div></div>
      <div class="feat-title"><a onclick="openPage(${f.page_id})">${esc(f.title)}</a></div>
      ${f.lead.map(p => `<p>${esc(p.length > 420 ? p.slice(0, 420) + "…" : p)}</p>`).join("")}
      ${f.first_text ? `<div class="feat-then">Its very first version, ${fmtDate(f.first_edit)}: “${esc(f.first_text.slice(0, 220))}${f.first_text.length > 220 ? "…" : ""}”</div>` : ""}
      <div class="more"><a onclick="openPage(${f.page_id})">Read it through time →</a> · <a onclick="openPage(${f.page_id}, null, 'history')">View history</a></div>`;
    drawSpark($("#featSpark"), f.months);
  }
  const d = h.dyk, L = (o, label) => o ? `<a onclick="openPage(${o.page_id})">${esc(label || o.title)}</a>` : "";
  const facts = [];
  if (d.oldest) facts.push(`… that the oldest article in the history of Finland, ${L(d.oldest)}, was first written on <b>${fmtDate(d.oldest.first_edit)}</b>?`);
  if (d.most_edited) facts.push(`… that ${L(d.most_edited)} has been saved <b>${nf(d.most_edited.versions)}</b> times, more than any other article on Finnish history?`);
  if (d.most_editors) facts.push(`… that <b>${nf(d.most_editors.n)}</b> different people have edited ${L(d.most_editors)}?`);
  if (d.most_vandalised) facts.push(`… that vandalism on ${L(d.most_vandalised)} has been reverted <b>${nf(d.most_vandalised.n)}</b> times?`);
  if (d.oldest_passage) facts.push(`… that a passage in ${L(d.oldest_passage)} has stood unchanged since <b>${fmtDate(d.oldest_passage.since)}</b>?`);
  if (d.biggest_cut) facts.push(`… that the largest single edit removed <b>${nf(-d.biggest_cut.delta)}</b> bytes from ${L(d.biggest_cut)} on ${fmtDate(d.biggest_cut.ts)}${d.biggest_cut.undone ? ", and was reverted" : ""}?`);
  if (d.anon) facts.push(`… that <b>${d.anon.pct}%</b> of all ${nf(d.anon.n)} edits were made by anonymous editors?`);
  $("#mpDyk").innerHTML = `<ul>${facts.map(f => `<li>${f}</li>`).join("")}</ul><div class="more"><a onclick="go('radar')">More from the edit history →</a></div>`;
  const today = new Date(h.date + "T00:00:00Z");
  $("#mpOtd").innerHTML = `<div style="font-weight:700;margin-bottom:6px">${today.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}</div><ul>`
    + h.on_this_day.map(o => `<li><span class="otd-year">${o.year}</span> – ${L(o)} was edited ${o.edits} times that day${o.wars > 0 ? `, with <span style="color:var(--war)">${o.wars} reverts between editors</span>` : ""}. <a onclick="openPage(${o.page_id}, '${o.year}-${h.date.slice(5)}')">See it then</a></li>`).join("")
    + h.born.map(o => `<li><span class="otd-year">${o.year}</span> – the article ${L(o)} was created.</li>`).join("") + "</ul>";
  const r = await api("/api/radar");
  const seen = new Set(), wars = [];
  for (const w of r.wars || []) { if (!seen.has(w.page_id)) { seen.add(w.page_id); wars.push(w); } if (wars.length === 5) break; }
  $("#mpWars").innerHTML = `<ul>${wars.map(w => `<li><b>${new Date(w.month + "-01").toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</b> – ${L(w)}: ${w.war_reverts} reverts between named editors in one month. <a onclick="openPage(${w.page_id}, '${w.month}-28')">Go to that month</a></li>`).join("")}</ul>
    <div class="more"><a onclick="go('radar')">All edit wars →</a></div>`;
}
function drawSpark(svg, months) {
  if (!svg || !months || !months.length) return;
  const W = 300, H = 50, max = Math.max(...months.map(m => m.edits));
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("preserveAspectRatio", "none");
  svg.innerHTML = months.map(m => {
    const t = Date.UTC(+m.month.slice(0, 4), +m.month.slice(5) - 1, 1), x = (t - START) / (END - START) * W, h = Math.max(1, Math.sqrt(m.edits / max) * (H - 4));
    return `<rect x="${x.toFixed(1)}" y="${H - h}" width="1.2" height="${h}" fill="${m.war_reverts >= 3 ? "var(--war)" : "var(--bar)"}"/>`;
  }).join("");
}

/* ------------------------------------------------------------------ TIME MACHINE */
const PAGE_EXAMPLES = ["Talvisota", "Suomen sisällissota", "Urho Kekkonen", "Carl Gustaf Emil Mannerheim", "Lapuanliike", "Sanna Marin", "Koronaviruspandemia Suomessa"];
(async () => {
  const chips = [];
  for (const t of PAGE_EXAMPLES) { const r = await api(`/api/pages?q=${encodeURIComponent(t)}`); if (r[0]) chips.push(r[0]); }
  state.byTitle = Object.fromEntries(chips.map(c => [c.title, c.page_id]));
  $("#pageExamples").innerHTML = chips.map(r => `<button class="chip" onclick="openPage(${r.page_id})">${esc(r.title)} <span style="color:var(--text-muted)">· ${nf(r.versions)}</span></button>`).join("");
  $("#lensExamples").innerHTML = chips.slice(0, 5).map(r => `<button class="chip" onclick="openLens(${r.page_id})">${esc(r.title)}</button>`).join("");
  $$("#navTry a[data-page]").forEach(a => a.onclick = () => openPage(state.byTitle[a.dataset.page]));
  $$("#navTry a[data-lens]").forEach(a => a.onclick = () => openLens(state.byTitle[a.dataset.lens]));
})();
suggestBox($("#pageQ"), $("#pageResults"), { onPick: x => openPage(x.page.page_id) });
$$("#machine .tab[data-mt]").forEach(t => t.onclick = () => setMode(t.dataset.mt));
$("#tabLens").onclick = () => state.page && openLens(state.page.page_id);
$("#cmpDate").onchange = () => loadArticle();
$$("#cmpBar [data-jump]").forEach(b => b.onclick = () => {
  const base = state.at || END;
  $("#cmpDate").value = new Date(+b.dataset.jump === 0 ? END : base - 31557600000).toISOString().slice(0, 10); loadArticle();
});
function setMode(mt) {
  state.mt = mt;
  $$("#machine .tab[data-mt]").forEach(t => t.classList.toggle("sel", t.dataset.mt === mt || (mt === "read" && t.dataset.mt === "read")));
  $$("#machine .tabs-l .tab[data-mt]").forEach(t => t.classList.toggle("sel", mt === "read" || mt === "compare"));
  $("#cmpBar").classList.toggle("hidden", mt !== "compare");
  if (state.page) history.replaceState(null, "", `#machine/${state.page.page_id}/${atISO() || "today"}${mt !== "read" ? "/" + mt : ""}`);
  loadArticle();
}
async function openPage(id, at, mt) {
  if (!id) return;
  go("machine", false); stopPlay();
  if (at && at !== "today") setAt(Date.parse(at), false); else if (at === null && !state.at) setAt(END, false);
  state.mt = mt || "read"; state.histShown = 60;
  state.page = await api(`/api/page/${id}`);
  $("#machineEmpty").classList.add("hidden"); $("#machine").classList.remove("hidden");
  $("#mTitle").textContent = state.page.title;
  $("#tl").innerHTML = ""; $("#duels").innerHTML = `<span class="spin"></span>Reading ${nf(state.page.versions)} versions…`;
  state.timeline = null; renderInfobox(); resetBlame(); setMode(state.mt);
  const tl = await api(`/api/timeline/${id}`);
  if (state.page.page_id !== id) return;
  state.timeline = tl; drawTimeline(tl); renderInfobox();
  $("#duels").innerHTML = tl.duels.length ? `<span>Who fought:</span>` + tl.duels.map(d => `<span class="duel">${esc(d.a)} ⇄ ${esc(d.b)} <b>${d.reverts}</b></span>`).join("") : "<span>No edit wars between named editors detected.</span>";
  state.mTraceTimeline = tl.trace;
  if (state.mt === "history") renderHistory();
}
function renderInfobox() {
  const p = state.page, s = p.stats || {};
  const langs = (s.languages || []).filter(l => l.lang !== "fi");
  $("#infobox").innerHTML = `<caption>${esc(p.title)}</caption>
    <tr><td colspan="2" class="ib-spark"><svg id="ibSpark"></svg><div class="ib-note">edits per month, 2003–2026${s.war_reverts ? " · red: edit wars" : ""}</div></td></tr>
    <tr><td colspan="2" class="ib-head">Life of the article</td></tr>
    <tr><th>First version</th><td>${fmtDate(p.first_edit)}</td></tr>
    <tr><th>Latest version</th><td>${fmtDate(p.last_edit)}</td></tr>
    <tr><th>Versions</th><td>${nf(p.versions)}</td></tr>
    <tr><th>Editors</th><td>${nf(s.editors)}${s.anon_pct != null ? ` <span style="color:var(--text-muted)">(${s.anon_pct}% of edits anonymous)</span>` : ""}</td></tr>
    <tr><th>Reverts</th><td>${nf(s.reverts)}</td></tr>
    <tr><th>· vandalism undone</th><td>${nf(s.vandalism_reverts)}</td></tr>
    <tr><th>· edit-war reverts</th><td style="color:${s.war_reverts ? "var(--war)" : "inherit"}">${nf(s.war_reverts)}</td></tr>
    <tr><td colspan="2" class="ib-head">In WikiPilot</td></tr>
    <tr><th>Passages through time</th><td>${nf(s.passages)}</td></tr>
    <tr><th>Full text</th><td>${p.deep ? `<span class="tier hot">hot · InnoDB</span>` : `<span class="tier s3">cold · S3</span>`}</td></tr>
    ${langs.length ? `<tr><th>Other languages</th><td>${langs.map(l => `<a href="${l.url}" target="_blank" rel="noopener">${l.lang === "sv" ? "Svenska" : "English"}</a>`).join(" · ")}<br><a onclick="openLens(${p.page_id})">Compare languages →</a></td></tr>` : ""}
    <tr><th>On Wikipedia</th><td><a href="https://fi.wikipedia.org/?curid=${p.page_id}" target="_blank" rel="noopener">fi.wikipedia.org ↗</a></td></tr>`;
  if (state.timeline) drawSpark($("#ibSpark"), state.timeline.months);
}
function resetBlame() {
  $("#blame").innerHTML = `<h3>Who wrote this?</h3><div class="blame-empty">Click any sentence in the article. WikiPilot checks <b>every saved version</b> in one SQL statement and shows when the sentence first appeared, who wrote it, and each time it was removed or restored.</div>`;
}
async function loadArticle() {
  const p = state.page; if (!p) return;
  const at = atISO() || "2026-10-01", my = ++state.artReq;
  if (state.timeline) drawTimeline(state.timeline);
  $("#mSub").innerHTML = `From Wikipedia, the free encyclopedia · <b>as it stood on ${state.at ? fmtDate(state.at) : "1 October 2026 (latest)"}</b>`;
  if (state.mt === "history") return renderHistory();
  if (!playTimer) $("#reader").innerHTML = `<div class="loading"><span class="spin"></span>Travelling to ${esc($("#when").textContent)}…</div>`;
  if (state.mt === "compare") {
    const d = await api(`/api/diff/${p.page_id}?a=${at}&b=${$("#cmpDate").value}`);
    if (my !== state.artReq) return;
    renderDiff(d); renderTrace($("#mTrace"), [...(state.mTraceTimeline || []), ...(d.trace || [])]); return;
  }
  const v = await api(`/api/article/${p.page_id}?at=${at}`);
  if (my !== state.artReq) return;
  renderTrace($("#mTrace"), [...(state.mTraceTimeline || []), ...(v.trace || [])]);
  if (v.error) { $("#reader").innerHTML = `<div class="ver-note old">This article did not exist yet on ${esc($("#when").textContent)}. It was first written on <b>${fmtDate(p.first_edit)}</b>. <a onclick="setAt(Date.parse('${p.first_edit}') + 86400000)">Go there</a></div>`; return; }
  const m = v.meta, old = !!state.at && !!m.replaced;
  const note = `<div class="ver-note ${old ? "old" : ""}">${old ? "This is an <b>old revision</b> of this page, " : "This is the version "}saved by <b>${esc(m.user)}</b>${m.anonymous ? " (anonymous)" : ""} at ${fmtTime(m.saved)}, ${fmtDate(m.saved)}${m.comment ? ` (“${esc(wtx(m.comment).slice(0, 110))}”)` : ""}.
    ${old ? `It was replaced on ${fmtDate(m.replaced)}.` : ""} <a href="${WIKI}${m.rev_id}" target="_blank" rel="noopener">Open on Wikipedia ↗</a>${m.tier === "s3" ? " · <span class='tier s3'>read from S3 cold tier</span>" : ""}</div>`;
  if (!v.blocks.length) { $("#reader").innerHTML = note + `<p style="color:var(--text-muted)">The full text of this article's history is still being archived to S3. Its timeline, infobox and history are complete.</p>`; return; }
  const ageBar = `<div class="age-bar"><button class="cdx-btn" id="ageBtn">${state.showAge ? "Hide" : "Show"} text age</button>
    <span class="age-legend ${state.showAge ? "" : "hidden"}" id="ageLegend">unchanged for: <i class="a0"></i>&lt;1 y <i class="a1"></i>1–3 y <i class="a2"></i>3–6 y <i class="a3"></i>6–10 y <i class="a4"></i>10+ y</span></div>`;
  $("#reader").innerHTML = note + ageBar + v.blocks.map(([k, t], i) => k === "h" ? `<h2>${esc(t)}</h2>` : k === "h3" ? `<h3>${esc(t)}</h3>` :
    `<p class="${k === "li" ? "li" : ""}" data-i="${i}">${t.split(/(?<=[.!?])\s+(?=[A-ZÅÄÖ0-9"“])/).map(s => `<span class="s">${esc(s)}</span>`).join(" ")}</p>`).join("");
  $$("#reader .s").forEach(s => s.onclick = () => blameSentence(s));
  $("#ageBtn").onclick = () => {
    state.showAge = !state.showAge;
    $("#ageBtn").textContent = (state.showAge ? "Hide" : "Show") + " text age";
    $("#ageLegend").classList.toggle("hidden", !state.showAge);
    if (state.showAge) loadAges(my); else $$("#reader p[data-i]").forEach(p => p.classList.remove("age0", "age1", "age2", "age3", "age4"));
  };
  if (state.showAge) loadAges(my);
}
// Text age: tint each paragraph by how long its passage has existed unchanged (passage.row_start).
async function loadAges(my) {
  const at = atISO() || "2026-10-01", r = await api(`/api/ages/${state.page.page_id}?at=${at}`);
  if (my !== state.artReq) return;
  const ref = state.at || END;
  for (const a of r.ages) {
    const p = $(`#reader p[data-i="${a.i}"]`); if (!p) continue;
    const y = a.since ? (ref - Date.parse(a.since + "Z")) / 31557600000 : 0;
    p.classList.add("age" + (y < 1 ? 0 : y < 3 ? 1 : y < 6 ? 2 : y < 10 ? 3 : 4));
    p.title = a.since ? `Unchanged since ${fmtDate(a.since + "Z")}` : "Changed within the last year";
  }
  renderTrace($("#mTrace"), [...(state.mTraceTimeline || []), ...(r.trace || [])]);
}
async function blameSentence(el) {
  $$("#reader .s.picked").forEach(s => s.classList.remove("picked")); el.classList.add("picked");
  const p = state.page;
  $("#blame").innerHTML = `<h3>Who wrote this?</h3><div class="quote">${esc(el.textContent)}</div><div class="loading"><span class="spin"></span>Checking all ${nf(p.versions)} versions${p.deep ? "" : " straight from the S3 cold tier (about 20 seconds)"}…</div>`;
  if (innerWidth <= 1100) $("#blame").scrollIntoView({ behavior: "smooth", block: "start" });
  const b = await api("/api/blame", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page_id: p.page_id, sentence: el.textContent, at: atISO() || "2026-10-01" }) });
  if (b.error) { $("#blame").innerHTML = `<h3>Who wrote this?</h3><div class="quote">${esc(el.textContent)}</div><p style="color:var(--text-muted)">${esc(b.error)}</p>`; return; }
  const f = b.first;
  $("#blame").innerHTML = `<h3>Who wrote this?</h3><div class="quote">${esc(el.textContent)}</div>
    ${b.story ? `<div class="story">${esc(b.story)}</div>` : ""}
    <div class="stats3"><div class="stat"><b>${f ? new Date(f.ts).getUTCFullYear() : "?"}</b><span>first written</span></div><div class="stat"><b>${b.removed_times}</b><span>times removed</span></div><div class="stat"><b>${b.restored_times}</b><span>times restored</span></div></div>
    <ul class="events">${b.events.map((e, i) => `<li><span class="k ${e.kind === "added" ? "add" : "rm"}">${e.kind === "added" ? "+ added" : "− removed"}<small>${fmtShort(e.ts)}</small></span>
      <span><b>${esc(e.user)}</b>${e.anon ? " <small style='display:inline'>(anon)</small>" : ""} · <a href="${WIKI}${e.rev_id}" target="_blank" rel="noopener">version ↗</a> · <a onclick="setAt(Date.parse('${e.ts}')+1000)">go there</a>${e.comment ? `<small>“${esc(wtx(e.comment))}”</small>` : ""}</span></li>`).join("")}</ul>
    <p style="font-size:11.5px;color:var(--text-muted);margin:10px 0 0">Matched “${esc(b.needle)}” across ${nf(b.versions_scanned)} versions in ${nf(b.ms)} ms (${b.tier === "hot" ? "FOR SYSTEM_TIME ALL" : "S3 cold tier"} + LAG()).</p>`;
}
function renderHistory() {
  const tl = state.timeline;
  if (!tl) { $("#reader").innerHTML = `<div class="loading"><span class="spin"></span>Reading the history…</div>`; return; }
  const cut = state.at ? state.at + 86400000 : Infinity;
  const vs = tl.versions.filter(v => Date.parse(v.ts + "Z") <= cut).reverse(), shown = vs.slice(0, state.histShown);
  const big = n => Math.abs(n) >= 500 ? " big" : "";
  $("#reader").innerHTML = `<div class="hist-head">Revision history${state.at ? ` up to <b>${fmtDate(state.at)}</b>` : ""}: ${nf(vs.length)} versions. (cur) = difference with the latest version, (prev) = difference with the preceding version. Click a date to read that version.</div>
    <ul class="hist">${shown.map((v, i) => {
      const prev = vs[i + 1], d = v.delta || 0;
      return `<li class="${i === 0 && state.at ? "cur" : ""}"><span class="pm">(<a onclick="diffVersions('${v.ts}', null)">cur</a> | ${prev ? `<a onclick="diffVersions('${prev.ts}', '${v.ts}')">prev</a>` : "prev"})</span>
        <a onclick="state.mt='read'; setMode('read'); setAt(Date.parse('${v.ts}Z')+1000)">${fmtTime(v.ts + "Z")}, ${fmtDate(v.ts + "Z")}</a>
        <b>${esc(v.user)}</b>${v.anon ? `<span class="tag anon">anon</span>` : ""} · (${nf(v.len)} bytes) <span class="${d > 0 ? "plus" : d < 0 ? "minus" : "pm"}${big(d)}">(${d > 0 ? "+" : ""}${nf(d)})</span>
        ${v.comment ? `<span class="cmt">(${esc(wtx(v.comment))})</span>` : ""}${v.revert ? `<span class="tag rv">revert</span>` : ""}
        <a href="${WIKI}${v.rev_id}" target="_blank" rel="noopener" style="font-size:11px">↗</a></li>`;
    }).join("")}</ul>
    ${vs.length > shown.length ? `<p><button class="cdx-btn" onclick="state.histShown+=100; renderHistory()">Show 100 older versions</button></p>` : ""}`;
}
async function diffVersions(a, b) {
  state.mt = "compare"; $("#cmpBar").classList.remove("hidden");
  $$("#machine .tab[data-mt]").forEach(t => t.classList.toggle("sel", t.dataset.mt === "compare"));
  $("#reader").innerHTML = `<div class="loading"><span class="spin"></span>Comparing versions…</div>`;
  const bb = b || "2026-10-01";
  $("#cmpDate").value = bb.slice(0, 10);
  const d = await api(`/api/diff/${state.page.page_id}?a=${encodeURIComponent(a)}&b=${encodeURIComponent(bb)}`);
  renderDiff(d); renderTrace($("#mTrace"), d.trace || []);
}
function renderDiff(d) {
  if (d.error) { $("#reader").innerHTML = `<p>${esc(d.error)}</p>`; return; }
  const s = d.stats, W = ws => ws.map(([op, w]) => op === "=" ? esc(w) : op === "-" ? `<del>${esc(w)}</del>` : "").join(" "),
        Wi = ws => ws.map(([op, w]) => op === "=" ? esc(w) : op === "+" ? `<ins>${esc(w)}</ins>` : "").join(" ");
  const rows = d.ops.map(o =>
    o.op === "same" ? `<tr><td colspan="2" class="ctx">… ${o.n} unchanged paragraph${o.n > 1 ? "s" : ""}${o.preview.length ? ": " + o.preview.map(p => esc(p[1])).join(" · ") : ""} …</td></tr>` :
    o.op === "changed" ? `<tr><td class="del">${W(o.words)}</td><td class="ins">${Wi(o.words)}</td></tr>` :
    o.op === "removed" ? `<tr><td class="del">${esc(o.text)}</td><td class="empty"></td></tr>` :
    `<tr><td class="empty"></td><td class="ins">${esc(o.text)}</td></tr>`).join("");
  $("#reader").innerHTML = `<div class="diff-stats"><span><b>${s.same}</b> unchanged</span><span><b>${s.changed}</b> edited</span><span style="color:var(--red)"><b>${s.removed}</b> removed</span><span style="color:var(--green)"><b>${s.added}</b> added</span>
      <a href="${DIFF(d.a.rev_id, d.b.rev_id)}" target="_blank" rel="noopener">same diff on Wikipedia ↗</a></div>
    <table class="diff"><thead><tr><th><b>Revision as of ${fmtTime(d.a.saved)}, ${fmtDate(d.a.saved)}</b>${esc(d.a.user)}</th><th><b>Revision as of ${fmtTime(d.b.saved)}, ${fmtDate(d.b.saved)}</b>${esc(d.b.user)}</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function drawTimeline(tl) {
  const svg = $("#tl"), W = svg.clientWidth || 900, H = 120, pad = 16;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const months = tl.months; if (!months.length) return;
  const max = Math.max(...months.map(m => m.edits)), x = t => (t - START) / (END - START) * W, bw = Math.max(1, W / 286 - .6);
  let h = "";
  for (let y = 2004; y <= 2026; y += 2) { const xx = x(Date.UTC(y, 0, 1)); h += `<line x1="${xx}" x2="${xx}" y1="0" y2="${H - pad}" stroke="var(--border-muted)"/><text x="${xx + 3}" y="${H - 3}" font-size="10" fill="var(--text-muted)">${y}</text>`; }
  for (const m of months) {
    const xx = x(Date.UTC(+m.month.slice(0, 4), +m.month.slice(5) - 1, 1)), bh = Math.sqrt(m.edits / max) * (H - pad - 20);
    if (m.war_reverts >= 3) h += `<rect x="${xx - 1}" y="0" width="${bw + 2}" height="${H - pad}" fill="var(--war)" opacity=".1"/>`;
    h += `<rect x="${xx}" y="${H - pad - bh}" width="${bw}" height="${bh}" fill="var(--bar)" opacity=".8"><title>${m.month}: ${m.edits} edits, ${m.reverts} reverts (${m.war_reverts} between named editors), ${m.editors} editors</title></rect>`;
    if (m.reverts - m.war_reverts > 0) h += `<circle cx="${xx + bw / 2}" cy="10" r="${Math.min(4.5, 1.5 + Math.sqrt(m.reverts - m.war_reverts))}" fill="var(--vandal)"/>`;
    if (m.war_reverts > 0) h += `<circle cx="${xx + bw / 2}" cy="${H - pad - bh - 6}" r="${Math.min(5.5, 2 + Math.sqrt(m.war_reverts))}" fill="var(--war)"/>`;
  }
  const at = state.at || END; h += `<line x1="${x(at)}" x2="${x(at)}" y1="0" y2="${H - pad}" stroke="var(--accent)" stroke-width="2"/>`;
  svg.innerHTML = h;
  svg.onclick = e => { const r = svg.getBoundingClientRect(); setAt(START + (END - START) * (e.clientX - r.left) / r.width); };
}

/* ------------------------------------------------------------------ EDIT WARS */
async function loadRadar() {
  state.radarLoaded = true;
  $("#kpis").innerHTML = `<div class="loading"><span class="spin"></span>Scanning every version of every article…</div>`;
  const [r, st] = await Promise.all([api("/api/radar"), api("/api/stats")]);
  const tot = r.years.reduce((a, y) => ({ e: a.e + +y.edits, r: a.r + +y.reverts, w: a.w + +y.war_reverts, an: a.an + +y.anon }), { e: 0, r: 0, w: 0, an: 0 });
  $("#kpis").innerHTML = [[nf(st.pages), "articles"], [nf(tot.e), "versions analysed"], [nf(tot.r), "reverts"], [nf(tot.w), "edit-war reverts"], [Math.round(100 * tot.an / tot.e) + "%", "edits by anonymous editors"]]
    .map(([b, s]) => `<div class="kpi"><b>${b}</b><span>${s}</span></div>`).join("");
  drawYears2(r.years);
  const maxW = Math.max(...r.top.map(t => +t.war_reverts));
  $("#topTbl").innerHTML = `<thead><tr><th>Article</th><th>Edits</th><th>Vandalism reverts</th><th>Edit-war reverts</th></tr></thead><tbody>` +
    r.top.slice(0, 18).map(t => `<tr onclick="openPage(${t.page_id})"><td><a>${esc(t.title)}</a></td><td class="num">${nf(t.edits)}</td><td class="num">${nf(t.vandalism_reverts)}</td><td class="num">${nf(t.war_reverts)}<span class="minibar" style="width:${40 * t.war_reverts / maxW}px"></span></td></tr>`).join("") + "</tbody>";
  $("#warsList").innerHTML = r.wars.map(w => `<div class="war" onclick="openPage(${w.page_id}, '${w.month}-28')"><div class="war-head"><a>${esc(w.title)}</a><span class="war-n">${w.war_reverts} reverts</span></div>
    <small>${new Date(w.month + "-01").toLocaleDateString("en-GB", { month: "long", year: "numeric" })} · ${esc((w.reverters || "").slice(0, 90))} ⇄ ${esc((w.reverted || "").slice(0, 90))}</small></div>`).join("");
  const ids = r.top.slice(0, 20).map(t => t.page_id), title = Object.fromEntries(r.top.map(t => [t.page_id, t.title]));
  const yrs = []; for (let y = 2004; y <= 2026; y++) yrs.push(y);
  const cell = {}; let mx = 1; r.heat.forEach(c => { cell[c.page_id + ":" + c.year] = +c.war_reverts; mx = Math.max(mx, +c.war_reverts); });
  const heat = $("#heat"); heat.style.gridTemplateColumns = `140px repeat(${yrs.length}, 1fr)`;
  heat.innerHTML = ids.map(id => `<div class="lbl" onclick="openPage(${id})" title="${esc(title[id])}">${esc(title[id])}</div>` + yrs.map(y => {
    const v = cell[id + ":" + y] || 0;
    return `<div class="c" title="${esc(title[id])} ${y}: ${v} edit-war reverts" style="background:${v ? `color-mix(in srgb, var(--war) ${15 + 85 * Math.sqrt(v / mx)}%, var(--bg-sub))` : "var(--bg-sub)"}"></div>`;
  }).join("")).join("") + `<div></div>` + yrs.map(y => `<div class="yr">${y % 4 === 0 ? "'" + String(y).slice(2) : ""}</div>`).join("");
  renderTrace($("#rTrace"), r.trace);
}
function drawYears2(years) {
  const svg = $("#yearsChart"), W = svg.clientWidth || 560, H = 220, pad = 20;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const ys = years.filter(y => y.year >= 2003 && y.year <= 2026), max = Math.max(...ys.map(y => +y.edits)), bw = W / ys.length;
  svg.innerHTML = ys.map((y, i) => {
    const hN = (y.edits - y.anon) / max * (H - pad - 16), hA = y.anon / max * (H - pad - 16), x = i * bw + 2, hW = y.war_reverts / max * (H - pad - 16) * 4;
    return `<g><title>${y.year}: ${nf(y.edits)} edits (${nf(y.anon)} anonymous), ${nf(y.reverts)} reverts, ${nf(y.war_reverts)} edit-war reverts, ${nf(y.editors)} editors</title>
      <rect x="${x}" y="${H - pad - hN}" width="${bw - 4}" height="${hN}" fill="var(--bar)"/>
      <rect x="${x}" y="${H - pad - hN - hA}" width="${bw - 4}" height="${hA}" fill="var(--vandal)"/>
      <rect x="${x + (bw - 4) / 3}" y="${H - pad - hW}" width="${(bw - 4) / 3}" height="${hW}" fill="var(--war)"/>
      ${y.year % 2 === 0 ? `<text x="${x + (bw - 4) / 2}" y="${H - 5}" font-size="10" text-anchor="middle" fill="var(--text-muted)">${y.year}</text>` : ""}</g>`;
  }).join("") + `<text x="${W - 4}" y="11" font-size="10.5" text-anchor="end" fill="var(--text-muted)">■ named · ■ anonymous · <tspan fill="var(--war)">■ edit-war reverts ×4</tspan></text>`;
}

/* ------------------------------------------------------------------ LANGUAGE LENS */
suggestBox($("#lensQ"), $("#lensResults"), { onPick: x => openLens(x.page.page_id) });
async function openLens(id) {
  if (!id) return;
  go("lens", false); history.replaceState(null, "", `#lens/${id}`);
  const p = await api(`/api/page/${id}`); $("#lensQ").value = p.title;
  $("#lensOut").innerHTML = `<div class="loading"><span class="spin"></span>Reading “${esc(p.title)}” in Finnish, Swedish and English and comparing them…</div>`;
  const r = await api(`/api/lens/${id}`);
  if (r.error) { $("#lensOut").innerHTML = `<p>${esc(r.error)}</p>`; return; }
  const L = { fi: "Suomi · Finnish", sv: "Svenska · Swedish", en: "English" };
  let h = `<div class="interlang">${["fi", "sv", "en"].map(l => r.versions[l] ? `<div class="lang"><div class="code">${L[l].toUpperCase()}</div><a href="${r.versions[l].url}" target="_blank" rel="noopener">${esc(r.versions[l].title)}</a><div style="font-size:12px;color:var(--text-muted)">${nf(r.versions[l].chars)} characters</div></div>`
    : `<div class="lang missing"><div class="code">${L[l].toUpperCase()}</div><b>No article on this topic</b><div style="font-size:12px;color:var(--text-muted)">Closest by meaning: ${(r.nearest[l] || []).slice(0, 2).map(n => `<a href="${n.url}" target="_blank" rel="noopener">${esc(n.title)}</a>`).join(", ") || "—"}</div></div>`).join("")}</div>`;
  const a = r.analysis;
  if (a) {
    h += `<div class="lens-sum">${esc(a.summary)}</div>
      <table class="wikitable lens-tbl"><thead><tr><th style="width:22%">Point</th><th>Finnish</th><th>Swedish</th><th>English</th></tr></thead><tbody>` +
      a.differences.map(d => `<tr><td class="topic"><b>${esc(d.topic)}</b><span class="kind ${d.kind}">${d.kind}</span><div class="note">${esc(d.note)}</div></td>${["fi", "sv", "en"].map(l => `<td class="${(d[l] || "—").trim() === "—" ? "absent" : ""}">${esc(d[l] || "—")}</td>`).join("")}</tr>`).join("") + `</tbody></table>
      <div class="mw-body"><h2>For editors</h2><ul>${a.editor_suggestions.map(s => `<li>${esc(s)}</li>`).join("")}</ul></div>`;
  } else h += `<p class="hatnote">Only the Finnish article exists for this topic. The closest articles in other languages are listed below.</p>`;
  h += `<div class="near">${["fi", "sv", "en"].map(l => `<div class="card"><h3>Related · ${L[l].split(" · ").pop()}</h3><div style="font-size:11.5px;color:var(--text-muted)">bge-m3 vector index, across languages</div><ol>${(r.nearest[l] || []).map(n => `<li><a href="${n.url}" target="_blank" rel="noopener">${esc(n.title)}</a> <small style="color:var(--text-muted)">${(1 - n.distance).toFixed(2)}</small></li>`).join("")}</ol></div>`).join("")}</div>
    <details class="hood"><summary>Under the hood</summary><div class="trace" id="lTrace"></div></details>`;
  $("#lensOut").innerHTML = h; renderTrace($("#lTrace"), r.trace);
}

/* ------------------------------------------------------------------ HOW IT WORKS */
async function loadHow() {
  state.howLoaded = true;
  const s = await api("/api/stats");
  $("#howKpis").innerHTML = [[nf(s.versions), "versions in a system-versioned table"], [nf(s.passage_rows), "passage rows through time, each with a vector"], [nf(s.passages_now), "passages on Wikipedia today"], [nf(s.s3_tables), "MariaDB S3 tables (cold tier)"], [nf(s.articles_now), "articles in fi · sv · en"]]
    .map(([b, t]) => `<div class="kpi"><b>${b}</b><span>${t}</span></div>`).join("");
  $("#howBody").innerHTML = `${DIAGRAM}
  <div class="how-grid"><div>
  <h2>Wikipedia's history as a system-versioned table</h2>
  <p>All 862,076 saved versions of 19,742 articles were written with their <b>real Wikipedia edit times</b> using <code>system_versioning_insert_history</code>. MariaDB keeps the history itself, with no revision table, so “what did Wikipedia show on 1 June 2012?” is plain SQL:</p>
  <pre>SELECT title, rev_id, user, text
FROM article FOR SYSTEM_TIME AS OF TIMESTAMP '2012-06-01 00:00:00'
WHERE page_id = 1256;</pre>
  <h2>Time-travel RAG: a vector index on a system-versioned table</h2>
  <p>Each article was cut into passages on 1 January of every year of its life. Each distinct passage is one row whose system-time period is exactly <i>when that text was on Wikipedia</i>. With a <code>VECTOR INDEX</code> on the same table, retrieval is time-aware in one statement, fused with full-text search by reciprocal-rank fusion:</p>
  <pre>SELECT page_id, chash, VEC_DISTANCE_COSINE(embedding, VEC_FromText(?)) d
FROM passage FOR SYSTEM_TIME AS OF TIMESTAMP '2008-07-01 00:00:00'
ORDER BY d LIMIT 60;</pre>
  <h2>Sentence blame in one query</h2>
  <p><code>LOCATE</code> over every version, and <code>LAG()</code> over system time to find where the sentence appears and disappears:</p>
  <pre>WITH v AS (SELECT rev_id, row_start ts, user, LOCATE(?, text) > 0 has
           FROM article FOR SYSTEM_TIME ALL WHERE page_id = ?),
     w AS (SELECT *, COALESCE(LAG(has) OVER (ORDER BY ts), 0) had FROM v)
SELECT * FROM w WHERE has <> had ORDER BY ts;</pre>
  </div><div>
  <h2>Hot and cold history: the MariaDB S3 engine</h2>
  <p>12.2 GB of wikitext does not fit a laptop. The most-edited articles keep their full text in the InnoDB system-versioned table (hot). The full text of <b>every</b> version lives in Aria tables moved to S3 object storage (IronShard) with <code>ALTER TABLE … ENGINE=S3</code>. They are read-only and compressed, and still read with ordinary SQL, by primary key, through the versioned metadata.</p>
  <pre>ALTER TABLE rev_archive_07 ENGINE=S3;   -- moves it to the bucket
SELECT text FROM rev_archive WHERE page_id = ? AND ts = ?;</pre>
  <h2>Edit wars from window functions</h2>
  <p>A revert is a version whose text hash differs from the previous version but equals an earlier one. <code>LAG(user)</code> tells whose edit was undone. Named editors undoing named editors is an edit war; undoing anonymous edits is vandalism cleanup.</p>
  <pre>sha1 <> LAG(sha1) OVER w
  AND MIN(row_start) OVER (PARTITION BY page_id, sha1) < row_start</pre>
  <h2>Main Page, from SQL</h2>
  <p>“Did you know…”, “On this day” and the featured article are queries over the history: the oldest surviving passage (<code>ORDER BY row_start</code> on current rows), the busiest article on today's date in each year (<code>ROW_NUMBER() OVER (PARTITION BY YEAR(ts))</code>), and the largest single deletion.</p>
  <h2>Language lens</h2>
  <p>The same topic in Finnish, Swedish and English is matched by Wikidata id. Where a language has no article, the dataset's bge-m3 vectors find the closest one by meaning through a second vector index, across languages. Gemini lines up facts, omissions and framing (NPOV).</p>
  </div></div>`;
}
const DIAGRAM = `<svg class="diagram" viewBox="0 0 1000 262" font-family="sans-serif" font-size="13">
  <defs><marker id="ar" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--text-muted)"/></marker></defs>
  <g fill="var(--bg)" stroke="var(--border-sub)"><rect x="10" y="20" width="200" height="220"/><rect x="290" y="20" width="420" height="220"/><rect x="790" y="20" width="200" height="100"/><rect x="790" y="140" width="200" height="100"/></g>
  <text x="110" y="46" text-anchor="middle" font-weight="700" fill="var(--text)">Datasets</text>
  <text x="110" y="76" text-anchor="middle" fill="var(--text-sub)">M · 862k versions</text><text x="110" y="96" text-anchor="middle" fill="var(--text-muted)" font-size="11">wikitext, 2003–2026</text>
  <text x="110" y="136" text-anchor="middle" fill="var(--text-sub)">S · fi / sv / en today</text><text x="110" y="156" text-anchor="middle" fill="var(--text-muted)" font-size="11">+ bge-m3 vectors</text>
  <text x="110" y="196" text-anchor="middle" fill="var(--text-sub)">Gemini embedding 2</text><text x="110" y="216" text-anchor="middle" fill="var(--text-muted)" font-size="11">768-d passage vectors</text>
  <text x="500" y="46" text-anchor="middle" font-weight="700" fill="var(--text)">MariaDB 12.3</text>
  <g font-size="12"><rect x="310" y="60" width="185" height="70" fill="var(--bg-sub)" stroke="var(--accent)"/><text x="402" y="82" text-anchor="middle" font-weight="700" fill="var(--link)">article</text><text x="402" y="100" text-anchor="middle" fill="var(--text-sub)">WITH SYSTEM VERSIONING</text><text x="402" y="117" text-anchor="middle" fill="var(--text-muted)" font-size="11">real edit times · hot text</text>
  <rect x="505" y="60" width="185" height="70" fill="var(--bg-sub)" stroke="var(--accent)"/><text x="597" y="82" text-anchor="middle" font-weight="700" fill="var(--link)">passage</text><text x="597" y="100" text-anchor="middle" fill="var(--text-sub)">SYSTEM VERSIONING</text><text x="597" y="117" text-anchor="middle" fill="var(--text-muted)" font-size="11">+ VECTOR INDEX + FULLTEXT</text>
  <rect x="310" y="145" width="185" height="70" fill="var(--bg-sub)" stroke="var(--green)"/><text x="402" y="167" text-anchor="middle" font-weight="700" fill="var(--green)">rev_archive_01…16</text><text x="402" y="185" text-anchor="middle" fill="var(--text-sub)">ENGINE=S3 (Aria)</text><text x="402" y="202" text-anchor="middle" fill="var(--text-muted)" font-size="11">every version, full text</text>
  <rect x="505" y="145" width="185" height="70" fill="var(--bg-sub)" stroke="var(--border-sub)"/><text x="597" y="167" text-anchor="middle" font-weight="700" fill="var(--text)">article_now · version_stat</text><text x="597" y="185" text-anchor="middle" fill="var(--text-sub)">VECTOR(1024) bge-m3</text><text x="597" y="202" text-anchor="middle" fill="var(--text-muted)" font-size="11">edit-war analytics</text></g>
  <text x="890" y="58" text-anchor="middle" font-weight="700" fill="var(--text)">IronShard S3</text><text x="890" y="80" text-anchor="middle" fill="var(--text-muted)" font-size="11">bucket: wikipilot</text><text x="890" y="98" text-anchor="middle" fill="var(--text-muted)" font-size="11">cold history tier</text>
  <text x="890" y="178" text-anchor="middle" font-weight="700" fill="var(--text)">WikiPilot app</text><text x="890" y="200" text-anchor="middle" fill="var(--text-muted)" font-size="11">FastAPI · SSE · Gemini</text>
  <g stroke="var(--text-muted)" stroke-width="1.5" fill="none" marker-end="url(#ar)"><path d="M210 90 H300"/><path d="M210 190 H300"/><path d="M710 120 C 748 120, 748 190, 782 190"/></g>
  <path d="M402 215 V 250 H 752 V 75 H 782" fill="none" stroke="var(--green)" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#ar)"/>
  <text x="560" y="246" text-anchor="middle" font-size="11" fill="var(--green)">ALTER TABLE … ENGINE=S3</text></svg>`;

/* ------------------------------------------------------------------ boot + deep links */
drawYears(); setAt(END, false);
api("/api/activity").then(a => { state.activity = a; drawStrata(); }).catch(() => {});
loadHome().catch(e => console.error(e));
// #home  #ask/<question>[/YYYY-MM-DD]  #machine/<id>[/<date>|today][/history|compare]  #lens/<id>  #radar  #how
(function route() {
  const [tab, a, b, c] = location.hash.slice(1).split("/").map(decodeURIComponent);
  if (tab === "machine" && a) openPage(+a, b || null, c);
  else if (tab === "lens" && a) openLens(+a);
  else if (tab === "ask" && a) { if (b) setAt(Date.parse(b), false); ask(a); }
  else if (VIEWS.includes(tab)) go(tab, false);
  else go("home", false);
})();
