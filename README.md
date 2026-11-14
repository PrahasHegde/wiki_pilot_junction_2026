# WikiPilot — Wikipedia, read through time

Every Wikipedia article has been rewritten hundreds or thousands of times, and every earlier version
is still kept. Readers almost never see them. **WikiPilot** lets you fly through that history. Ask
Wikipedia a question *as it stood on any day since 2003*, see how the answer drifted, watch an
article rewrite itself, click any sentence to find out who wrote it and how often it was fought
over, and compare how Finnish, Swedish and English Wikipedia tell the same history.

It looks and works like Wikipedia, so readers and editors know their way around from the first
click. The Main Page has *Featured article*, *Did you know…*, *In the edit wars* and *On this day*,
all computed from the edit history in SQL. Article pages have an infobox, *Read · Compare · View
history* tabs, superscript citations with hover previews, an "old revision" notice, and Wikipedia's
two-column diff. Day and night themes are included.

It covers **both tracks, built as one system**. All of it runs on MariaDB features:

| | MariaDB feature | What it gives the reader or editor |
|---|---|---|
| **Time-travel RAG** | `VECTOR INDEX` **on a system-versioned table**, `FOR SYSTEM_TIME AS OF` + `VEC_DISTANCE_COSINE` + `MATCH…AGAINST` fused in **one SQL statement** | Grounded, cited answers from Wikipedia as it was on any date. *Then vs now* and *drift over the years* modes |
| **Time machine** | `article` table `WITH SYSTEM VERSIONING`: all **862,076 versions** with real edit times (`system_versioning_insert_history`) | Any article on any day, its whole life as a timeline, and a diff between any two moments |
| **Sentence blame** | `LOCATE` over `FOR SYSTEM_TIME ALL` + `LAG()` window: one query | Who wrote this sentence, when, and every time it was removed or restored, told in plain language |
| **Text age** | `passage FOR SYSTEM_TIME AS OF`: each passage's `row_start` is when its exact text appeared | A heat map over any article: settled text vs fresh text, at any date |
| **Main Page from SQL** | Window functions over the history (`ROW_NUMBER() OVER (PARTITION BY YEAR(ts))`, oldest current `row_start`) | *Did you know…*, *On this day in Wikipedia's history*, a featured article with its life sparkline |
| **Edit-war radar** | Window functions over the full history (`sha1` revert detection, `LAG(user)`) | Where knowledge is contested: named editors undoing each other vs vandalism cleanup |
| **Cold history in object storage** | **MariaDB S3 storage engine**: `ALTER TABLE … ENGINE=S3` on an S3-compatible bucket (IronShard) | The full text of every version (12.2 GB of wikitext) stays queryable with SQL, without local disk |
| **Language lens** | The dataset's bge-m3 vectors in a second vector index, cross-language | Same topic in fi / sv / en: differing facts, omissions and framing (NPOV), with suggestions for editors |

## What we found

- **Wikipedia's account changes, and you can watch it change.** Ask *"What did Wikipedia say about the
  1918 prison camps in 2008, and what has changed since?"*. In 2008 the civil-war article blamed the
  camp deaths on a *"harkittu rankaisumentaliteetti ja välinpitämättömyys"* ("calculated punitive
  mentality and indifference"). Today that framing is gone, and the article gives per-camp execution
  counts, the Fellman field camp and the 1921–1927 releases instead. The number of convicted went
  from 68,000 (2006) to 70,000 (2012).
- **A vector index works on a system-versioned table.** `FOR SYSTEM_TIME AS OF` and the HNSW index
  combine in one statement. For an indexed `AS OF` search we got the same top results as the exact
  scan, at 1–160 ms against seconds for the scan.
- **Passages live exactly as long as their text did.** Each article was snapshotted on 1 January of
  every year plus today, and cut into passages. A passage's system-time period is when that text was
  on Wikipedia. Unchanged passages are stored and embedded once, however many years they survive.
  Every answer shows each source's lifespan ("on Wikipedia since 2009", or "2007–2014, then removed").
- **Most reverts are cleanup, not edit wars, and the wars follow the news.** Of 862,076 versions,
  45,668 are reverts, and only 10,427 are named editors undoing each other. Window functions over the
  whole versioned table do this in 51 s. The fiercest wars line up with real events, without being
  told about them: Pekka Haavisto in January 2012 (the presidential election), the Jokela school
  shooting in November 2007 (the week it happened), Ilkka Kanerva in March 2008 (his text-message
  scandal). The most contested articles are presidents and prime ministers (Halonen, Niinistö,
  Marin), not wars.
- **Blame is one query.** "Which versions contain this sentence, and where does that flip?" is
  `LOCATE` over `FOR SYSTEM_TIME ALL` plus `LAG()`. For *Talvisota* that is a scan of 2,143 versions.
- **Hot/cold tiering with the S3 engine.** All 862k versions keep their metadata in the versioned
  InnoDB table. The full text of the most-edited articles stays hot. The full text of *every* version
  sits in Aria tables moved to S3 (3.0 GB of wikitext became 1.25 GB per archive table). The app
  reads hot text first and falls back to S3 transparently.
- **Route S3 reads by key range.** A `UNION ALL` view over the 16 S3 tables worked with 2 tables
  (0.6 s) but not with 16: the `page_id = ?` predicate was not pushed into every branch, and one
  read streamed tables from object storage for 16 minutes. A small `archive_map` table (page-id
  range → table) sends each read to exactly one S3 table by primary key: 0.5–2 s. Blame over all
  1,376 versions of a cold article, straight from S3: ~19 s.
- **One embedding model per index, always.** A query embedded with a different model than the
  passages returns nonsense with no error. We record the passage model in a `meta` table, and the
  app embeds questions with that model.

## Run it

Needs Docker, Python 3.11+, a Gemini API key, and optionally an S3-compatible bucket.

```bash
pip install -r requirements.txt
cp .env.example .env                 # GEMINI_API_KEY=..., access_key/secret_key for S3
docker compose up -d --build --wait  # MariaDB 12.3 + S3 engine, port 3309

# data: the S and M datasets from github.com/MariaDB/mariadb-wikipedia-datasets → data/s, data/m
python scripts/load_history.py       # 862k versions → system-versioned `article` (real edit times)
python scripts/build_passages.py     # yearly passages + Gemini vectors → system-versioned `passage`
python scripts/load_s.py             # fi/sv/en articles + bge-m3 vectors (language lens)
python scripts/analyze.py            # revert/edit-war stats for the radar
python scripts/archive_s3.py         # full text of every version → MariaDB S3 tables (cold tier)

python main.py                       # http://localhost:8765
```

Every loader can be stopped and run again: it resumes where it left off. The long jobs pause
on their own when the host disk drops below 3 GB free (`MIN_FREE_GB`). That matters because
Docker's disk image on Windows only grows. `scripts/compact_docker_disk.ps1`, run as
Administrator, gives the unused space back.
`python scripts/ask_cli.py "question" [YYYY-MM-DD]` asks from the terminal.

Deep links for demos: `#machine/1256/2010-01-01` · `#lens/1256` · `#ask/<question>/<date>` · `#radar` · `#how`

## The key SQL

```sql
-- Time-travel hybrid retrieval: one statement.
WITH vec AS (
  SELECT page_id, chash, VEC_DISTANCE_COSINE(embedding, VEC_FromText(?)) AS distance
  FROM passage FOR SYSTEM_TIME AS OF TIMESTAMP '2008-07-01 00:00:00'
  ORDER BY distance LIMIT 60),                                    -- vector index
kw AS (
  SELECT page_id, chash, MATCH(title, section, text) AGAINST (? IN BOOLEAN MODE) AS score
  FROM passage FOR SYSTEM_TIME AS OF TIMESTAMP '2008-07-01 00:00:00'
  WHERE MATCH(title, section, text) AGAINST (? IN BOOLEAN MODE)
  ORDER BY score DESC LIMIT 60),                                  -- full-text index
...                                                                -- reciprocal-rank fusion
SELECT ... FROM fused JOIN passage FOR SYSTEM_TIME AS OF TIMESTAMP '2008-07-01 00:00:00' ...

-- Sentence blame: when did this text appear and disappear, across every version?
WITH v AS (SELECT rev_id, row_start AS ts, user, comment, LOCATE(?, text) > 0 AS has
           FROM article FOR SYSTEM_TIME ALL WHERE page_id = ?),
     w AS (SELECT *, COALESCE(LAG(has) OVER (ORDER BY ts), 0) AS had FROM v)
SELECT * FROM w WHERE has <> had ORDER BY ts;

-- Cold tier: move a table to S3 object storage; it stays queryable.
ALTER TABLE rev_archive_07 ENGINE=S3;
```

Every view in the app has an **Under the hood** panel showing the exact SQL it ran, with timings.

## Architecture

```
 dataset M (862k versions) ──► load_history ──► article   WITH SYSTEM VERSIONING   (hot: metadata + text)
                          └──► archive_s3   ──► rev_archive_01..16  ENGINE=S3  ──► IronShard bucket (cold: all text)
                          └──► build_passages (yearly snapshots, Gemini embedding 2, 768-d)
                                             ──► passage   WITH SYSTEM VERSIONING + VECTOR INDEX + FULLTEXT
 dataset S (fi/sv/en + bge-m3) ──► load_s   ──► article_now + article_now_vector (VECTOR INDEX)
 analyze ──► version_stat (window functions over FOR SYSTEM_TIME ALL)

 main.py (FastAPI, SSE) ── Gemini 3.8 Flash (answers, drift, lens) · 3.5 Flash (planning, blame story)
 web/ (no framework): Ask · Time machine · Edit wars · Language lens · How it works
```

## Choices, and why

- **System time = Wikipedia's edit time.** An edit time *is* a transaction time: the commit to
  Wikipedia's own MariaDB. `system_versioning_insert_history` moves that commit to our server, and
  every query stays plain `FOR SYSTEM_TIME`.
- **Passages from yearly snapshots, not from every version.** Embedding all 862k versions would
  embed the same paragraphs thousands of times. Yearly snapshots plus content-addressed passages
  embed each distinct text once, and still answer "as of" any date.
- **The model plans the time question.** A fast Gemini call reads "in 2008", "what has changed since"
  and "over the years" into a mode and a date, and rewrites the question as Finnish search terms.
  Finnish is heavily inflected, so full-text search uses prefix terms (`vankilei*`).
- **Grounded and neutral.** Answers come only from the retrieved passages. Every claim is cited, and
  every citation links to the exact version (`?oldid=`). Where sources disagree, the prompt asks for
  both sides (NPOV).

## Licence

Code: MIT. Wikipedia text and anything derived from it (passages, vectors): CC BY-SA 4.0, credit to
Wikipedia's authors. Datasets: [MariaDB Foundation](https://github.com/MariaDB/mariadb-wikipedia-datasets).
