# WikiPilot — Developer Guide

> **WikiPilot is an AI agent for Wikipedia.** Search engines show you today's Wikipedia. WikiPilot
> has read every version ever written. Ask it what Wikipedia says now or said on any day since
> 2003, watch an article rewrite itself, find out who wrote any sentence, see where editors fought,
> compare three language editions, and let Gemini help editors fix neutrality and illustrate
> articles. It runs on **MariaDB** (system-versioned tables, vector search and the S3 engine) and
> **Gemini**, for the *Wikipedia Through Time* challenge at Junction 2026.

This guide is for the team: how to run it, how it is built, where everything lives, and the plan
for the demo video.

---

## Contents

1. [Run it](#1-run-it)
2. [Architecture](#2-architecture)
3. [The data: tables and pipeline](#3-the-data-tables-and-pipeline)
4. [Features: what you see and how it works](#4-features-what-you-see-and-how-it-works)
5. [Gemini in WikiPilot](#5-gemini-in-wikipilot)
6. [API reference](#6-api-reference)
7. [Frontend](#7-frontend)
8. [Configuration](#8-configuration)
9. [Operations and troubleshooting](#9-operations-and-troubleshooting)
10. [Numbers to quote](#10-numbers-to-quote)
11. [Demo video plan](#11-demo-video-plan)

---

## 1. Run it

### Prerequisites

| | |
|---|---|
| Docker Desktop | runs MariaDB 12.3 with the S3 engine plugin (`docker/Dockerfile`) |
| Python 3.11+ | backend and data scripts (`pip install -r requirements.txt boto3 playwright`) |
| Node 18+ | builds the React frontend |
| `.env` | Gemini key and S3 keys (see [Configuration](#8-configuration)) |

### Start everything (data already loaded)

```bash
docker compose up -d --wait          # MariaDB on port 3309
python scripts/check.py              # health check (add --app once main.py runs)
python main.py                       # WikiPilot on http://localhost:8765
```

Wait for these console lines before you demo:

```
warm-up done: ...                    # vector indexes, Main Page and Edit wars cached (~20 s)
warm-up translations done            # Talvisota pre-translated to English (~60 s)
```

The first search after a cold start takes ~6–16 s while MariaDB loads the vector index. After
warm-up every search takes 20–160 ms.

### After changing the frontend

```bash
cd frontend && npm run build         # writes frontend/dist, which main.py serves at /
npm run dev                          # live-reload dev server on :5173, proxies /api to :8765
```

### Useful URLs (deep links)

| Link | Opens |
|---|---|
| `/?theme=light` · `/?theme=dark` | Forces a theme (use for recording) |
| `#ask/<question>` · `#ask/<question>/2008-07-01` | Asks a question, optionally as of a date |
| `#machine/1256/2010-01-01` | *Talvisota* (Winter War) as of 1 Jan 2010 |
| `#machine/1256/2015-03-01/history` | Its revision history up to that date |
| `#machine/1256/today/compare` | Compare view |
| `#studio` · `#studio/1256` | Editor studio landing / with *Talvisota* open |
| `#lens/1256` | Finnish vs Swedish vs English Winter War |
| `#radar` | Edit wars |
| `#radar/10907/2008-03` | Edit-war analysis: Ilkka Kanerva, March 2008 |
| `?age=1` | Opens the article with *text age* switched on |

Handy page ids: **1256** Talvisota · **1150** Suomen sisällissota (Civil War) · **1187** Tarja Halonen ·
**11477** Lapuanliike · **327** Hanoi Rocks (cold-tier example: its full text is read from S3).

---

## 2. Architecture

```
                   ┌──────────────────────── Browser (React + Vite) ─────────────────────────┐
                   │ Main page · Ask · Time machine · Editor studio · Edit wars · Lens · ⌘K   │
                   │ 🎙 MediaRecorder → /api/voice      🔊 /api/tts → <audio>     SSE answers  │
                   └──────────────────────────────────┬────────────────────────────────────────┘
                                                      │ JSON / SSE
                   ┌──────────────────────────────────▼────────────────────────────────────────┐
                   │ main.py — FastAPI                                                          │
                   │ wikipilot/ ask · search · history · radar · lens · mainpage · studio        │
                   └───────┬──────────────────────────────┬───────────────────────────┬────────┘
                           │ SQL                          │ REST                      │
         ┌─────────────────▼─────────────────┐   ┌────────▼─────────┐        ┌────────▼─────────┐
         │ MariaDB 12.3 (Docker, :3309)      │   │ Gemini API        │        │ IronShard S3     │
         │ article   WITH SYSTEM VERSIONING  │   │ Embedding 2       │        │ bucket wikipilot │
         │ passage   WITH SYSTEM VERSIONING  │   │ 3.5 Flash (fast)  │        │ (rev_archive_*)  │
         │           + VECTOR INDEX+FULLTEXT │   │ Flash TTS         │        └────────▲─────────┘
         │ version_stat · article_now(+vec)  │   │ Flash Image       │                 │
         │ rev_archive_01..16  ENGINE=S3 ────┼───┼───────────────────┼─────────────────┘
         └───────────────────────────────────┘   └──────────────────┘
```

**Two ideas carry the design:**

1. **Wikipedia's edit history is a system-versioned table.** All 862,076 versions were written with
   their *real* Wikipedia edit times (`system_versioning_insert_history`). "What did Wikipedia show
   on 1 June 2012?" is plain `FOR SYSTEM_TIME AS OF`.
2. **Retrieval is time-aware inside the database.** Passages live in a second system-versioned
   table with a **vector index**. Each passage row exists in system time exactly as long as its
   text was on Wikipedia, so one statement does vector + full-text search *as of any date*.

**Request flow, e.g. "What did Wikipedia say about the 1918 prison camps in 2008, and what has changed since?":**

1. `ask.plan()`: Gemini 3.5 Flash reads the time intent. Mode `compare`, date `2008-07-01`, a
   Finnish search sentence and keywords.
2. `search.embed_question()`: Gemini Embedding 2 (the same model that built the passages; see `meta`).
3. `search.retrieve()` runs twice, once as of 2008 and once now. Each run is one hybrid SQL statement:
   `VEC_DISTANCE_COSINE` (vector index) + `MATCH … AGAINST`, fused by reciprocal rank, both
   `FOR SYSTEM_TIME AS OF`.
4. Exact version ids for the citations: `article FOR SYSTEM_TIME AS OF` → `?oldid=` links.
5. Gemini 3.5 Flash (thinking off) streams the answer over SSE. Every sentence cites `[n]`, and the "then"
   citations show in green.
6. The *Under the hood* panel shows every SQL statement with its timing.

---

## 3. The data: tables and pipeline

Datasets from [MariaDB/mariadb-wikipedia-datasets](https://github.com/MariaDB/mariadb-wikipedia-datasets):
**M** (every version, 862k, wikitext) → `data/m/`, **S** (fi/sv/en today + bge-m3 vectors) → `data/s/`.

### Tables (`schema.sql`)

| Table | What it holds | Key MariaDB feature |
|---|---|---|
| `article` | One row per article; **862,076 history rows** with real edit times. Full wikitext for the 40 most-edited "hot" articles; metadata for all | `WITH SYSTEM VERSIONING`, `MEDIUMTEXT COMPRESSED`, `KEY (page_id, row_start)` |
| `page` | 19,742 articles: title, versions, first/last edit, `deep` (= hot text) | `FULLTEXT(title)` |
| `passage` | **288,642 passage rows** (103,605 current); each passage exists in system time exactly as long as it was on Wikipedia | `WITH SYSTEM VERSIONING` + `VECTOR(768)` **`VECTOR INDEX`** + `FULLTEXT` |
| `passage_done` · `meta` | Builder progress; `meta.embed_model` = the model that embedded the passages | — |
| `version_stat` | One row per version: delta, `is_revert`, whose edit was undone | Materialised with window functions over `FOR SYSTEM_TIME ALL` |
| `article_now` · `article_now_vector` | Dataset S: 29,460 articles in fi/sv/en + bge-m3 vectors | Second `VECTOR INDEX` (1024-d), cross-language |
| `article_category` | Finnish categories | — |
| `rev_archive_01 … 16` | **Full text of all 862,076 versions** (12.2 GB wikitext), compressed Aria tables moved to object storage | **`ENGINE=S3`** (IronShard bucket) |
| `archive_map` | page-id range → archive table, so each cold read hits one S3 table by primary key | — |

### Pipeline (run once, in order; every script resumes where it stopped)

| Step | Script | What it does | Took |
|---|---|---|---|
| 1 | `scripts/load_history.py` | M → `article` with real edit times (`system_versioning_insert_history`); picks the hot set by a disk budget | ~60 min |
| 2 | `scripts/build_passages.py` | Snapshots each article on 1 Jan of every year + today, cleans wikitext, cuts passages, embeds new text with Gemini, writes system-time periods | ~70 min for 19,742 articles |
| 3 | `scripts/load_s.py` | S → `article_now` + bge-m3 vectors + categories | 90 s |
| 4 | `scripts/analyze.py` | `version_stat` via window functions | 51 s |
| 5 | `scripts/archive_s3.py` | Per dataset file: build an Aria table → `ALTER TABLE … ENGINE=S3` → record `archive_map` | ~60 min (upload-bound) |

Long jobs pause automatically when the host disk drops below 3 GB (`wikipilot/diskguard.py`).

### The SQL worth showing

```sql
-- Time-travel hybrid retrieval (wikipilot/search.py — HYBRID_SQL), abridged
WITH vec AS (SELECT page_id, chash, VEC_DISTANCE_COSINE(embedding, VEC_FromText(?)) AS distance
             FROM passage FOR SYSTEM_TIME AS OF TIMESTAMP '2008-07-01 00:00:00'
             ORDER BY distance LIMIT 60),
     kw  AS (SELECT page_id, chash, MATCH(title, section, text) AGAINST (? IN BOOLEAN MODE) AS score
             FROM passage FOR SYSTEM_TIME AS OF TIMESTAMP '2008-07-01 00:00:00'
             WHERE MATCH(title, section, text) AGAINST (? IN BOOLEAN MODE) ORDER BY score DESC LIMIT 60)
-- … ROW_NUMBER() ranks, 1/(60+rank) reciprocal-rank fusion, join back AS OF …

-- Sentence blame (wikipilot/history.py — BLAME_HOT_SQL)
WITH v AS (SELECT rev_id, row_start ts, user, LOCATE(?, text) > 0 has
           FROM article FOR SYSTEM_TIME ALL WHERE page_id = ?),
     w AS (SELECT *, COALESCE(LAG(has) OVER (ORDER BY ts), 0) had FROM v)
SELECT * FROM w WHERE has <> had ORDER BY ts;

-- Reverts (wikipilot/radar.py — MATERIALISE_SQL)
sha1 <> LAG(sha1) OVER w AND MIN(row_start) OVER (PARTITION BY page_id, sha1) < row_start

-- Cold tier
ALTER TABLE rev_archive_07 ENGINE=S3;
SELECT text FROM rev_archive_07 WHERE page_id = ? AND ts = ?;     -- table chosen via archive_map
```

---

## 4. Features: what you see and how it works

| Feature | What the user sees | How it works | Code |
|---|---|---|---|
| **Main Page** | Wikipedia-style: *Featured article* (+ first-ever version), *Did you know…*, *In the edit wars*, *On this day in Wikipedia's history* | All boxes are SQL over the history (oldest surviving passage, `ROW_NUMBER() OVER (PARTITION BY YEAR(ts))` for today's date in past years, biggest deletion…); cached daily | `mainpage.py`, `Home.jsx` |
| **Time bar** | Global date scrubber 2003–2026 with an activity strip, **▶ Play history**, keyboard arrows | Every view reads the chosen moment; links carrying a date move it | `store.jsx`, `shell.jsx` |
| **Ask** — 4 modes | *Now*, *as of a date*, *then vs now*, *drift over the years*; streamed answer; superscript citations with hover previews; References with lifespan bars and *stable / new / since removed* badges | Planner → hybrid time-travel retrieval → grounded answer (only from sources, NPOV) | `ask.py`, `search.py`, `Ask.jsx` |
| **Time machine: Read** | The article as it stood on any day; "old revision" notice; infobox | `article FOR SYSTEM_TIME AS OF`; cold articles read from S3 by primary key | `history.py`, `Machine.jsx` |
| **Who wrote this? (blame)** | Click any sentence → when added, by whom, removed/restored N times, plus a plain-language story | `LOCATE` over every version + `LAG()`; Gemini 3.5 Flash writes the story | `history.blame` |
| **Text age** | Heat map: fresh text glows, settled text fades | `passage.row_start` of passages alive at that moment dates every paragraph | `history.ages` |
| **Compare / View history** | Wikipedia's two-column diff; Special:History-style list with *cur \| prev*, reverts tagged | Versions + revert flags from window functions | `history.diff`, `history.timeline` |
| **Edit wars** | KPIs, activity per year, heat map article × year, most contested articles, fiercest wars | `version_stat`: named editors undoing named editors = war; undoing anonymous = vandalism cleanup | `radar.py`, `Radar.jsx` |
| **Edit-war analysis** | Click a war in *Edit wars* (or *Why they fought* on the Main Page): headline, dispute type, two side cards with **portrayal** (hero / villain / victim / neutral / mixed), **sentiment** meter and tone words, quotes fi+en, what changed, outcome today, NPOV verdict, the contested wording with Wikipedia diff links | `version_stat` reverts → undone vs restored versions (hot table or S3, read in parallel) → paragraph/word diff → Gemini JSON; top 6 wars pre-computed at warm-up | `wars.py`, `WarPanel.jsx` |
| **Language lens** | fi / sv / en side by side: differences by kind (factual, omission, framing), suggestions for editors, related articles in each language | Same Wikidata id; bge-m3 vector index for closest articles across languages; Gemini 3.8 Flash compares | `lens.py`, `Lens.jsx` |
| **🎙 Voice** | Mic in every search box; speak in any language | Browser `MediaRecorder` → Gemini 3.5 Flash transcribes + detects language → asks | `studio.transcribe`, `voice.jsx` |
| **🔊 Listen** | Read answers and articles aloud | Gemini 3.8 Flash TTS → WAV | `studio.speak` |
| **🌐 Translate** | Any article version in 12 languages; answers in a chosen language | Paragraph-aligned batch translation (Gemini 3.5 Flash, 16 parallel requests), cached per version | `studio.translate` |
| **✏️ Editor studio** | Own page in the menu: pick an article and paragraph → **Neutrality / Citations needed / Clarity / Shorten** → issues, diff, English, *Copy wikitext*; **Illustrate** in 5 styles, edit the image in words, upload, download | Gemini 3.8 Flash with Wikipedia policies (NPOV, verifiability); Gemini 3.1 Flash Image for generation and editing; labelled AI-generated | `studio.py`, `Studio.jsx`, `StudioPage.jsx` |
| **⌘K palette** | Jump to an article, ask, travel to a year ("2008"), open studio or lens | Client-side over `/api/pages` | `Palette.jsx` |
| **Under the hood** | Every view: the exact SQL it ran and how long each step took | `db.Trace` | `db.py`, `ui.jsx` |

---

## 5. Gemini in WikiPilot

Five models, ten jobs (`wikipilot/gemini.py`, `wikipilot/studio.py`):

| Model | Jobs | Typical time |
|---|---|---|
| **Gemini Embedding 2** (768-d) | Embeds 288,642 passages and every question | 0.3 s / question |
| **Gemini 3.5 Flash** | ① plans the time intent of a question ② transcribes voice ③ translates article versions ④ tells a sentence's story in blame ⑤ writes image prompts | 2–6 s (translation of a long article ~30 s, then cached) |
| **Gemini 3.5 Flash** (also the model for ⑥–⑧, thinking off) | ⑥ grounded answers and drift timelines ⑦ language-lens comparison and **edit-war analysis** ⑧ editor studio rewrites (NPOV, citations, clarity, shorten) | first words ~4–8 s, studio ~3 s, war analysis ~7–10 s (top wars pre-computed) |
| **Gemini 3.8 Flash TTS** | ⑨ reads answers and articles aloud | ~3.5 s |
| **Gemini 3.1 Flash Image** | ⑩ illustrates a section and edits the image from instructions or an upload | ~9–11 s |

Guardrails: answers use only the retrieved sources, cite every sentence, and present both sides
where sources disagree. Studio rewrites never add facts. Images carry an AI-generated badge and
Wikimedia Commons guidance. Query embeddings always use the model recorded in `meta`.

---

## 6. API reference

| Method | Path | Returns |
|---|---|---|
| GET | `/api/ask?q=&date=&lang=` | **SSE**: `plan`, `sources`, `token`…, `drift`, `trace`, `done` |
| GET | `/api/pages?q=` | Article suggestions |
| GET | `/api/page/{id}` | Article metadata + infobox stats + other-language links |
| GET | `/api/article/{id}?at=` | Version at a moment: meta + cleaned blocks (hot or S3 tier) |
| GET | `/api/timeline/{id}` | Edits per month, all versions with revert flags, who fought whom |
| GET | `/api/diff/{id}?a=&b=` | Paragraph + word diff between two moments |
| POST | `/api/blame` `{page_id, sentence, at}` | Add/remove events, counts, Gemini story |
| GET | `/api/ages/{id}?at=` | Unchanged-since date per paragraph |
| GET | `/api/translate/{id}?at=&lang=` | Paragraph-aligned translation of that version |
| POST | `/api/voice` `{audio, mime}` | `{text, language}` |
| POST | `/api/tts` `{text}` | `audio/wav` |
| POST | `/api/studio/improve` `{title, text, task}` | `{rewrite, rewrite_en, issues[], summary}` |
| POST | `/api/studio/prompt` `{title, text, style}` | `{prompt}` |
| POST | `/api/studio/image` `{prompt, image?, mime?, style?}` | `{image (base64), mime, model, ms}` |
| GET | `/api/war/{id}/{YYYY-MM}` | Edit-war analysis: sides, portrayal, sentiment, changes, outcome, NPOV, disputes |
| GET | `/api/lens/{id}` | Language versions, Gemini analysis, nearest articles per language |
| GET | `/api/radar` · `/api/home` · `/api/stats` · `/api/activity` | Edit wars · Main Page · totals · time-bar strip |

CLI: `python scripts/ask_cli.py "question" [YYYY-MM-DD]` streams an answer in the terminal.

---

## 7. Frontend

`frontend/` — React 18 + Vite 5, Framer Motion (transitions), Lucide (icons). Wikipedia's Codex
design tokens (link blue, hairlines, serif headings) in a modern layout, light and dark.

```
src/
  main.jsx            entry
  App.jsx             shell: header, time bar, sidebar, view switch, ⌘K
  store.jsx           global state: route (hash), time (`at`), playback, theme
  lib.js              API helper, dates (UTC), markdown + citation renderer
  styles.css          all styles (tokens at the top; light + dark)
  components/
    shell.jsx         header, search box (+ mic), time bar, sidebar, footer
    ui.jsx            Globe loader, skeletons, KPI tiles, sparkline, lifespan bar, SQL panel, citation popover
    voice.jsx         MicButton (record → /api/voice), ListenButton (/api/tts)
    Palette.jsx       ⌘K command palette
  views/
    Home.jsx          Main Page
    Ask.jsx           Ask (SSE, modes, references, listen, answer language)
    Machine.jsx       Time machine (read, compare, history, blame, text age, translate)
    StudioPage.jsx    Editor studio page (article picker)
    Studio.jsx        Editor studio tools (improve, illustrate)
    Radar.jsx         Edit wars
    Lens.jsx          Language lens
```

Routing is hash based (`#view/arg/date/tab`). The time bar's date lives in `store.jsx`, and every
view refetches when it changes. Visual QA uses Playwright with real waits. Headless screenshots
that use "virtual time" catch animations mid-flight and look broken when they aren't.

---

## 8. Configuration

`.env` (keys are case-insensitive; never commit it):

| Key | Purpose |
|---|---|
| `gemini_api_key` | Gemini API |
| `access_key`, `secret_key` | IronShard S3 (used by MariaDB's S3 engine via docker-compose and by boto3) |
| `S3_ENDPOINT`, `S3_BUCKET` | `https://s3.ironshard.ai`, `wikipilot` |
| `GEMINI_MODEL`, `GEMINI_FAST_MODEL`, `GEMINI_EMBED_MODEL`, `GEMINI_TTS_MODEL`, `GEMINI_IMAGE_MODEL`, `GEMINI_STT_MODEL` | Optional overrides (defaults: 3.5 Flash, 3.5 Flash, Embedding 2, 3.8 Flash TTS, 3.1 Flash Image, 3.5 Flash) |
| `GEMINI_THINKING` (0) | Thinking-token budget for text generation; 0 = off, the main speed lever |
| `DB_PORT` (3309), `PORT` (8765), `MIN_FREE_GB` (3) | Optional |

The MariaDB database, user and Docker volume are still named `palimpsest` (the project's codename).
That is internal only.

---

## 9. Operations and troubleshooting

| Symptom | Fix |
|---|---|
| Not sure what is wrong | `python scripts/check.py` checks database, data, S3 tier, Gemini and frontend; `--app` also calls every API endpoint |
| "Can't reach the WikiPilot server" banner | Start `python main.py` (and MariaDB), then reload |
| "The frontend is not built yet" page | `cd frontend && npm install && npm run build` |
| Port 8000 taken | WikiPilot uses **8765** on purpose |
| First question slow (6–16 s) | Wait for `warm-up done`; the vector index loads into memory once |
| C: drive filling up | Docker's disk image only grows: run `scripts/compact_docker_disk.ps1` **as Administrator**; a reboot shrinks the page file |
| Cold article slow | Full text comes from S3: ~0.5–2 s per version, blame ~20 s. Hot articles (e.g. Talvisota) are instant |
| Nonsense search results | The query and passage embedding models differ. Check `SELECT * FROM meta` |
| UI change not visible | `cd frontend && npm run build`, then refresh (assets are content-hashed) |
| Mic does nothing | Browser microphone permission; mics only work on `localhost` or HTTPS |
| Gemini 429 / 5xx | `gemini._post` retries with backoff automatically |

---

## 10. Numbers to quote

| | |
|---|---|
| Versions in a system-versioned table | **862,076** (19,742 articles, 2003–2026) |
| Passages through time, each with a vector | **288,642** (103,605 on Wikipedia today) |
| Wikitext in MariaDB S3 tables | **12.2 GB** raw, all versions, 16 tables |
| Reverts / edit-war reverts | **45,668 / 10,427**; 19% of edits anonymous |
| Time-travel hybrid search | **20–160 ms** (warm), one SQL statement |
| Revert analysis over all versions | **51 s** |
| Languages | fi · sv · en side by side; translation into 12 |
| Gemini | **5 models, 10 jobs** |

**Real stories found by WikiPilot (use them on camera):**
- **2008 vs now:** the civil-war article blamed the 1918 prison-camp deaths on a *"calculated punitive mentality and indifference"*. That framing is gone today.
- **Drift:** the Winter War's start, from Mainila (2005) to "the shelling never happened" (2017) to Colonel Tikhomirov named (2023).
- **Edit wars follow the news:** Pekka Haavisto in January 2012 (the presidential election), the Jokela school shooting in November 2007, Ilkka Kanerva in March 2008.
- **Vandalism in 58 seconds:** 28 Jan 2015, a joke about condoms and AK-47s added to *Talvisota*, reverted by Stryn 58 s later.
- **Blame:** a *Talvisota* sentence added in 2009 by Peltimikko survived a vandal's deletion in 2010 and was removed in 2026 to tighten the intro.
- **Studio:** the NPOV check flags *"painosti"* ("pressured") in today's *Talvisota* and proposes *"vaati"* ("demanded").

---

## 11. Demo video plan

**Goal:** in ~3 minutes, show that WikiPilot is the most useful and original Wikipedia tool,
built on MariaDB (SVT + vectors + S3) and Gemini. Each judging criterion is covered at least once
(see the map at the end).

### Before recording (checklist)

- [ ] `docker compose up -d --wait` then `python main.py`; wait for **both** warm-up lines
- [ ] Record in **light theme** at 1920×1080: open `http://localhost:8765/?theme=light`; browser zoom 100–110%; hide bookmarks; use a clean browser profile
- [ ] Grant the microphone permission once beforehand (click the 🎙, allow, cancel)
- [ ] Pre-run the slow Gemini steps once so they are cached or warm: the two Ask chips, *Talvisota* translation, Editor studio NPOV on *Talvisota* ¶2
- [ ] Close other heavy apps (RAM); check C: has > 5 GB free
- [ ] Recorder: OBS at 1080p/30 fps, cursor highlight on, system audio on (for **Listen**)
- [ ] **Speed:** cut the waits in editing (answers stream for 25–40 s). Keep the first second of each stream so viewers see it is live

### Shot list (≈ 3:00)

| # | Time | Screen | Action | Narration (suggested) |
|---|---|---|---|---|
| 1 | 0:00–0:12 | Main Page | Slow scroll: badge → *Did you know…* → *On this day* | "Wikipedia is rewritten every day, and every old version is still there. Nobody can *ask* them. **Meet WikiPilot, an AI agent that has read every version ever written.**" |
| 2 | 0:12–0:40 | Ask | Click chip **then vs now, 1918 prison camps**. Show plan pills, streaming text, hover a superscript citation, point at a "2007–2014, since removed" lifespan | "It reads the time in your question, searches Wikipedia as it stood in 2008 *and* today, and cites the exact versions. In 2008 the article blamed the deaths on a 'calculated punitive mentality'. Today that framing is gone." |
| 3 | 0:40–0:52 | Ask | Open **Under the hood** | "One MariaDB statement: a vector index on a system-versioned table, `FOR SYSTEM_TIME AS OF`, fused with full-text search. 60 milliseconds." |
| 4 | 0:52–1:08 | Ask (voice) | Click 🎙, say *"How has the story of who started the Winter War changed over the years?"*; show drift timeline; click **Listen** for 3 s | "Ask by voice in any language. Gemini traces how the account drifted, from Mainila to Colonel Tikhomirov, and reads it back to you." |
| 5 | 1:08–1:35 | Time machine *Talvisota* | Click a *Try* link or use ⌘K "Talvisota"; press **▶ Play history** for 3 s; pause; **Show text age**; click a sentence → blame story | "Every article, on any day since 2003. Watch it rewrite itself. Text age shows what's settled and what's fresh. Click any sentence: who wrote it, when, and every time it was fought over, from one SQL query." |
| 6 | 1:35–1:45 | Time machine | Language menu → **English** (pre-cached) | "Read Finnish Wikipedia's past in your own language." |
| 7 | 1:45–1:58 | View history | Time bar 1 Mar 2015 → *View history* → **prev** on Stryn's revert | "Its real history: here a vandal's AK-47 joke, removed in 58 seconds." |
| 8 | 1:58–2:25 | **Editor studio** | Sidebar → Editor studio → *Talvisota* → ¶2 → **Neutrality**; then **Illustrate → Generate**; type *"turn it into a snowy night scene"* | "For editors: Gemini checks a paragraph against Wikipedia's neutrality policy. It flags 'pressured' and proposes 'demanded', as a diff. It also illustrates sections, and edits the image in plain words, clearly labelled AI-generated." |
| 9 | 2:25–2:40 | Edit wars | Scroll KPIs → heat map → click **Pekka Haavisto, January 2012** | "Across 862,000 versions, window functions find where knowledge is contested. Edit wars follow the news: the 2012 presidential election." |
| 10 | 2:40–2:52 | Language lens | `#lens/1256` | "Finnish, Swedish and English Wikipedia tell the Winter War differently. Only the Swedish article mentions the Pummanki incident." |
| 11 | 2:52–3:00 | Main Page (or title card) | Logo + tagline | "MariaDB system-versioned tables, vector search and the S3 engine; five Gemini models. **WikiPilot: Wikipedia, read through time.**" |

### Backup takes (if a live call is slow during recording)

- Record scenes 2, 4 and 8 separately and splice them in.
- Answers can be re-run instantly from the deep links in §1.
- If the mic misbehaves, type the scene-4 question. The drift result is the same.

### Judging criteria → scenes

| Criterion (20% each) | Shown in |
|---|---|
| Effective & creative use of MariaDB (RAG + SVT) | 2, 3, 5 (blame SQL), 9; S3 cold tier in narration of 11 |
| Implementation & scalability | 3 (ms timings), 9 (862k versions in 51 s), numbers in 11 |
| Usefulness for readers & editors | 2, 4, 6 (readers) · 5, 7, 8 (editors) |
| Design & demo quality | Wikipedia-native UI throughout, ⌘K, time bar, Play history |
| Originality | Time-travel RAG, drift timelines, sentence blame, text age, Gemini editor studio |
| Bonus: both tracks | Everything: RAG *on* system-versioned tables |
