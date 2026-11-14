import { nf } from "../lib";
import { Kpis } from "../components/ui";

const Code = ({ children }) => <pre>{children}</pre>;

export default function How({ stats: s }) {
  return (
    <div>
      <h1 className="firstHeading">How it works</h1>
      <div className="siteSub">All of it runs on MariaDB. Gemini only writes the words.</div>
      {s && <Kpis items={[[nf(s.versions), "versions in a system-versioned table"], [nf(s.passage_rows), "passage rows through time, each with a vector"], [nf(s.passages_now), "passages on Wikipedia today"], [nf(s.s3_tables), "MariaDB S3 tables (cold tier)"], [nf(s.articles_now), "articles in fi · sv · en"]]} />}
      <Diagram />
      <div className="mw-body how-grid">
        <div>
          <h2>Wikipedia's history as a system-versioned table</h2>
          <p>All 862,076 saved versions of 19,742 articles were written with their <b>real Wikipedia edit times</b> using <code>system_versioning_insert_history</code>. MariaDB keeps the history itself, with no revision table, so “what did Wikipedia show on 1 June 2012?” is plain SQL:</p>
          <Code>{`SELECT title, rev_id, user, text
FROM article FOR SYSTEM_TIME AS OF TIMESTAMP '2012-06-01 00:00:00'
WHERE page_id = 1256;`}</Code>
          <h2>Time-travel RAG: a vector index on a system-versioned table</h2>
          <p>Each article was cut into passages on 1 January of every year of its life. Each distinct passage is one row whose system-time period is exactly <i>when that text was on Wikipedia</i>. With a <code>VECTOR INDEX</code> on the same table, retrieval is time-aware in one statement, fused with full-text search by reciprocal-rank fusion:</p>
          <Code>{`SELECT page_id, chash, VEC_DISTANCE_COSINE(embedding, VEC_FromText(?)) d
FROM passage FOR SYSTEM_TIME AS OF TIMESTAMP '2008-07-01 00:00:00'
ORDER BY d LIMIT 60;`}</Code>
          <h2>Sentence blame in one query</h2>
          <p><code>LOCATE</code> over every version, and <code>LAG()</code> over system time to find where the sentence appears and disappears:</p>
          <Code>{`WITH v AS (SELECT rev_id, row_start ts, user, LOCATE(?, text) > 0 has
           FROM article FOR SYSTEM_TIME ALL WHERE page_id = ?),
     w AS (SELECT *, COALESCE(LAG(has) OVER (ORDER BY ts), 0) had FROM v)
SELECT * FROM w WHERE has <> had ORDER BY ts;`}</Code>
          <h2>Text age</h2>
          <p>The passages alive at a moment (<code>FOR SYSTEM_TIME AS OF</code>) carry their <code>row_start</code>: when that exact text first appeared. That dates every paragraph and turns the article into a heat map of settled and fresh text.</p>
        </div>
        <div>
          <h2>Hot and cold history: the MariaDB S3 engine</h2>
          <p>12.2 GB of wikitext does not fit a laptop. The most-edited articles keep their full text in the InnoDB system-versioned table (hot). The full text of <b>every</b> version lives in Aria tables moved to S3 object storage (IronShard) with <code>ALTER TABLE … ENGINE=S3</code>. They are read-only and compressed, and are still read with ordinary SQL. A small <code>archive_map</code> routes each read to the one table that holds the page, by primary key.</p>
          <Code>{`ALTER TABLE rev_archive_07 ENGINE=S3;   -- moves it to the bucket
SELECT tbl FROM archive_map WHERE ? BETWEEN lo AND hi;
SELECT text FROM rev_archive_07 WHERE page_id = ? AND ts = ?;`}</Code>
          <h2>Edit wars from window functions</h2>
          <p>A revert is a version whose text hash differs from the previous version but equals an earlier one. <code>LAG(user)</code> tells whose edit was undone. Named editors undoing named editors is an edit war; undoing anonymous edits is vandalism cleanup.</p>
          <Code>{`sha1 <> LAG(sha1) OVER w
  AND MIN(row_start) OVER (PARTITION BY page_id, sha1) < row_start`}</Code>
          <h2>Main Page, from SQL</h2>
          <p>“Did you know…”, “On this day” and the featured article are queries over the history: the oldest surviving passage (the earliest <code>row_start</code> among current rows), the busiest article on today's date in each year (<code>ROW_NUMBER() OVER (PARTITION BY YEAR(ts))</code>), and the largest single deletion.</p>
          <h2>Language lens</h2>
          <p>The same topic in Finnish, Swedish and English is matched by Wikidata id. Where a language has no article, the dataset's bge-m3 vectors find the closest one by meaning through a second vector index, across languages. Gemini lines up facts, omissions and framing (NPOV).</p>
          <h2>Frontend</h2>
          <p>React + Vite, Framer Motion and Lucide, designed to Wikipedia's Codex conventions. A FastAPI backend streams answers over Server-Sent Events. Every view has an <i>Under the hood</i> panel with the exact SQL it ran, and how long each statement took.</p>
        </div>
      </div>
    </div>
  );
}

function Diagram() {
  const T = (x, y, t, o = {}) => <text x={x} y={y} textAnchor="middle" fill={o.fill || "var(--text-sub)"} fontSize={o.size || 12} fontWeight={o.bold ? 700 : 400}>{t}</text>;
  return (
    <svg className="diagram" viewBox="0 0 1000 262" fontFamily="Inter, sans-serif">
      <defs><marker id="ar" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--text-muted)" /></marker></defs>
      <g fill="var(--bg)" stroke="var(--border-sub)"><rect x="10" y="20" width="200" height="220" rx="8" /><rect x="290" y="20" width="420" height="220" rx="8" /><rect x="790" y="20" width="200" height="100" rx="8" /><rect x="790" y="140" width="200" height="100" rx="8" /></g>
      {T(110, 46, "Datasets", { fill: "var(--text)", bold: true, size: 13 })}
      {T(110, 76, "M · 862k versions")}{T(110, 96, "wikitext, 2003–2026", { fill: "var(--text-muted)", size: 11 })}
      {T(110, 136, "S · fi / sv / en today")}{T(110, 156, "+ bge-m3 vectors", { fill: "var(--text-muted)", size: 11 })}
      {T(110, 196, "Gemini embedding 2")}{T(110, 216, "768-d passage vectors", { fill: "var(--text-muted)", size: 11 })}
      {T(500, 46, "MariaDB 12.3", { fill: "var(--text)", bold: true, size: 13 })}
      <rect x="310" y="60" width="185" height="70" rx="6" fill="var(--bg-sub)" stroke="var(--accent)" />{T(402, 82, "article", { fill: "var(--link)", bold: true })}{T(402, 100, "WITH SYSTEM VERSIONING")}{T(402, 117, "real edit times · hot text", { fill: "var(--text-muted)", size: 11 })}
      <rect x="505" y="60" width="185" height="70" rx="6" fill="var(--bg-sub)" stroke="var(--accent)" />{T(597, 82, "passage", { fill: "var(--link)", bold: true })}{T(597, 100, "SYSTEM VERSIONING")}{T(597, 117, "+ VECTOR INDEX + FULLTEXT", { fill: "var(--text-muted)", size: 11 })}
      <rect x="310" y="145" width="185" height="70" rx="6" fill="var(--bg-sub)" stroke="var(--green)" />{T(402, 167, "rev_archive_01…16", { fill: "var(--green)", bold: true })}{T(402, 185, "ENGINE=S3 (Aria)")}{T(402, 202, "every version, full text", { fill: "var(--text-muted)", size: 11 })}
      <rect x="505" y="145" width="185" height="70" rx="6" fill="var(--bg-sub)" stroke="var(--border-sub)" />{T(597, 167, "article_now · version_stat", { fill: "var(--text)", bold: true })}{T(597, 185, "VECTOR(1024) bge-m3")}{T(597, 202, "edit-war analytics", { fill: "var(--text-muted)", size: 11 })}
      {T(890, 58, "IronShard S3", { fill: "var(--text)", bold: true, size: 13 })}{T(890, 80, "bucket: wikipilot", { fill: "var(--text-muted)", size: 11 })}{T(890, 98, "cold history tier", { fill: "var(--text-muted)", size: 11 })}
      {T(890, 178, "WikiPilot app", { fill: "var(--text)", bold: true, size: 13 })}{T(890, 200, "React · FastAPI · SSE · Gemini", { fill: "var(--text-muted)", size: 11 })}
      <g stroke="var(--text-muted)" strokeWidth="1.5" fill="none" markerEnd="url(#ar)"><path d="M210 90 H300" /><path d="M210 190 H300" /><path d="M710 120 C 748 120, 748 190, 782 190" /></g>
      <path d="M402 215 V 250 H 752 V 75 H 782" fill="none" stroke="var(--green)" strokeWidth="1.5" strokeDasharray="5 4" markerEnd="url(#ar)" />
      {T(560, 246, "ALTER TABLE … ENGINE=S3", { fill: "var(--green)", size: 11 })}
    </svg>
  );
}
