-- WikiPilot — Wikipedia, read through time.  Tables created by scripts/load_history.py.
--
-- Two system-versioned tables carry the whole idea:
--   article  — every saved version of every Finnish "History of Finland" article (862,076),
--              written with Wikipedia's real edit times, so FOR SYSTEM_TIME AS OF '2012-05-01'
--              is literally "what Wikipedia showed that day".
--   passage  — the article text cut into passages, each with a vector. A passage row lives
--              exactly as long as that text lived on Wikipedia. Vector search + AS OF in one
--              statement = retrieval-augmented generation against Wikipedia *as it was*.

-- ---------------------------------------------------------------------------------------
-- 1. The edit history. One row per article = what Wikipedia shows today; every earlier
--    version is a history row kept by MariaDB. Text is stored for the "deep" articles
--    (the most edited, chosen by a disk budget); metadata for all of them.
CREATE TABLE IF NOT EXISTS article (
  page_id    INT UNSIGNED NOT NULL,
  title      VARCHAR(255) NOT NULL,
  rev_id     INT UNSIGNED NOT NULL,
  parent_id  INT UNSIGNED,
  user       VARCHAR(255),
  anonymous  BOOL NOT NULL DEFAULT 0,
  comment    TEXT,
  minor      BOOL NOT NULL DEFAULT 0,
  sha1       CHAR(31),
  len        INT UNSIGNED,
  text       MEDIUMTEXT COMPRESSED NULL,          -- NULL = metadata only for this article
  row_start  TIMESTAMP(6) GENERATED ALWAYS AS ROW START INVISIBLE,
  row_end    TIMESTAMP(6) GENERATED ALWAYS AS ROW END INVISIBLE,
  PERIOD FOR SYSTEM_TIME (row_start, row_end),
  PRIMARY KEY (page_id),
  KEY (sha1),
  KEY start_key (page_id, row_start),
  KEY (user)
) CHARACTER SET utf8mb4 WITH SYSTEM VERSIONING;

-- Which articles exist, and whether their full text history is loaded.
CREATE TABLE IF NOT EXISTS page (
  page_id     INT UNSIGNED NOT NULL PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  wikidata_id VARCHAR(20),
  versions    INT UNSIGNED NOT NULL DEFAULT 0,
  first_edit  DATETIME,
  last_edit   DATETIME,
  deep        BOOL NOT NULL DEFAULT 0,             -- full text of every version is in `article`
  KEY (title),
  FULLTEXT (title)
) CHARACTER SET utf8mb4;

-- ---------------------------------------------------------------------------------------
-- 2. Passages through time. Each distinct passage of an article is one row whose system-time
--    period is when it was on Wikipedia (from yearly snapshots + today's version). A passage
--    that disappears and comes back has two periods: two rows, same chash.
CREATE TABLE IF NOT EXISTS passage (
  page_id    INT UNSIGNED NOT NULL,
  chash      CHAR(16)     NOT NULL,                -- hash of the passage text
  title      VARCHAR(255) NOT NULL,
  section    VARCHAR(255),
  rev_id     INT UNSIGNED NOT NULL,                -- the version it was first seen in
  text       TEXT         NOT NULL,
  embedding  VECTOR(768)  NOT NULL,                -- gemini-embedding-2, 768 dimensions
  row_start  TIMESTAMP(6) GENERATED ALWAYS AS ROW START INVISIBLE,
  row_end    TIMESTAMP(6) GENERATED ALWAYS AS ROW END INVISIBLE,
  PERIOD FOR SYSTEM_TIME (row_start, row_end),
  PRIMARY KEY (page_id, chash),
  KEY (page_id, row_start),
  FULLTEXT (title, section, text),
  VECTOR INDEX (embedding) M=16 DISTANCE=cosine
) CHARACTER SET utf8mb4 WITH SYSTEM VERSIONING;

-- Settings recorded by the builders, e.g. which embedding model made the passage vectors.
-- Queries must be embedded with the same model: the app reads it from here.
CREATE TABLE IF NOT EXISTS meta (
  k VARCHAR(64) NOT NULL PRIMARY KEY,
  v VARCHAR(255) NOT NULL
);

-- Which pages have their passages built (makes the builder resumable).
CREATE TABLE IF NOT EXISTS passage_done (
  page_id   INT UNSIGNED NOT NULL PRIMARY KEY,
  passages  INT UNSIGNED NOT NULL,
  rows_     INT UNSIGNED NOT NULL
);

-- ---------------------------------------------------------------------------------------
-- 3. Today's Wikipedia in three languages (dataset S), with the ready-made bge-m3 vectors:
--    same topic across fi / sv / en via wikidata_id — for the language lens.
CREATE TABLE IF NOT EXISTS article_now (
  lang          CHAR(2)      NOT NULL,
  page_id       INT UNSIGNED NOT NULL,
  rev_id        INT UNSIGNED NOT NULL,
  wikidata_id   VARCHAR(20),
  title         VARCHAR(255) NOT NULL,
  url           VARCHAR(500) NOT NULL,
  date_modified DATETIME,
  text          MEDIUMTEXT   NOT NULL,
  PRIMARY KEY (lang, page_id),
  KEY (wikidata_id),
  KEY (title)
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS article_now_vector (
  lang       CHAR(2)      NOT NULL,
  page_id    INT UNSIGNED NOT NULL,
  embedding  VECTOR(1024) NOT NULL,                -- bge-m3, from the dataset
  PRIMARY KEY (lang, page_id),
  VECTOR INDEX (embedding) M=16 DISTANCE=cosine
);

CREATE TABLE IF NOT EXISTS article_category (
  page_id  INT UNSIGNED NOT NULL,
  category VARCHAR(255) NOT NULL,
  PRIMARY KEY (page_id, category),
  KEY (category)
) CHARACTER SET utf8mb4;

-- ---------------------------------------------------------------------------------------
-- 4. Edit-war analytics, materialised from `article` FOR SYSTEM_TIME ALL with window
--    functions (scripts/analyze.py). One row per version.
CREATE TABLE IF NOT EXISTS version_stat (
  page_id        INT UNSIGNED NOT NULL,
  rev_id         INT UNSIGNED NOT NULL,
  ts             DATETIME(6)  NOT NULL,
  user           VARCHAR(255),
  anonymous      BOOL NOT NULL,
  len            INT UNSIGNED,
  delta          INT,                              -- bytes added (+) or removed (-)
  is_revert      BOOL NOT NULL,                    -- text identical to an earlier, non-adjacent version
  undid_user     VARCHAR(255),                     -- whose edit this revert undid
  undid_anon     BOOL,
  PRIMARY KEY (page_id, ts, rev_id),
  KEY (ts),
  KEY (user)
) CHARACTER SET utf8mb4;

-- ---------------------------------------------------------------------------------------
-- 5. Which S3 archive table holds which page ids. A UNION ALL view over 16 S3 tables does not
--    push `page_id = ?` into each branch, so it streamed whole tables from S3 (minutes). Routing
--    to the one table by page-id range makes a cold read one primary-key lookup (~0.5 s).
CREATE TABLE IF NOT EXISTS archive_map (
  tbl VARCHAR(32)  NOT NULL PRIMARY KEY,
  lo  INT UNSIGNED NOT NULL,
  hi  INT UNSIGNED NOT NULL,
  KEY (lo, hi)
);
