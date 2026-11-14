# WikiPilot — 3-minute demo

Start: `docker compose up -d --wait && python main.py` → http://localhost:8765. Wait for
"warm-up done" in the console, so the vector indexes are cached before you start.

## 0:00 — Main Page (15 seconds)
Open on the **Main Page**. It looks like Wikipedia's, but every box is a SQL query over the history:
*Did you know* ("…that 1,150 people have edited Tarja Halonen?"), *On this day in Wikipedia's
history* (today's date in past years) and *In the edit wars*.
> "Wikipedia is rewritten every day, and the old versions are still there. Nobody can *ask* them.
> WikiPilot can."

## 0:15 — The hook (Ask)
Tip: `?theme=light` or `?theme=dark` in the URL picks the theme for the projector.

Click the chip **then vs now — 1918 prison camps in 2008**.
- Point at the plan pills: Gemini read "in 2008 … what has changed since" as *Then vs now*.
- While it streams, point at the **References** list: each source has a **lifespan bar** and a stability badge: "on Wikipedia 2007–2014,
  then removed". Every passage knows when it existed.
- The payoff: in 2008 the article blamed the deaths on a *"calculated punitive mentality and
  indifference"*. That framing is gone today. Hover a superscript citation (Wikipedia-style preview), then click **version of … ↗**: it
  opens the exact 2008 revision on Wikipedia.
- Open **Under the hood**: one SQL statement, `FOR SYSTEM_TIME AS OF` + `VEC_DISTANCE_COSINE` +
  `MATCH AGAINST` and a vector index **on a system-versioned table**. 60–160 ms.

## 0:50 — Drift
Click **drift — who started the Winter War**. The timeline shows how the account evolved:
Mainila → "the shelling never happened" (2017) → Colonel Tikhomirov named (2023).
> "This is how knowledge changes. Readers have never been able to see it."

## 1:20 — Time machine and blame (for editors)
Click a source's **time machine →** (or open *Talvisota*).
- The timeline: 2,143 versions, edit wars in red, vandalism in grey, *who fought whom*.
- Click **▶ Play history** and watch the article rewrite itself, year by year.
- Click **Show text age**: the intro glows (rewritten in September 2026), while older sections fade. Each
  paragraph is dated by its passage's system-time start.
- Pause, then **click a sentence**. Blame scans every version in one query and tells its story:
  "added in 2009 by Peltimikko, survived a vandal's deletion in 2010, removed in 2026 to tighten
  the intro."
- **View history** (time bar at 1 March 2015): Wikipedia's own history page, with reverts tagged.
  On 28 January 2015 an anonymous editor added a joke ("the Winter War is now on sale at the ticket
  office… bring condoms and an AK47"). Stryn removed it 58 seconds later. Click **prev** on Stryn's
  revert to see the two-column diff in Wikipedia's colours. WikiPilot counts this as vandalism
  cleanup, not an edit war, because the undone edit was anonymous.
- **Compare**: a word-level diff between any two dates (e.g. "−1 year").

## 2:00 — Edit wars
**Edit wars** tab: 862k versions analysed with window functions. The most contested articles, the
heat map by year, and the fiercest edit wars by month. Click one to jump to that month.

## 2:20 — Language lens
**Language lens → Talvisota**: Finnish, Swedish and English Wikipedia side by side. The Swedish
article gives the Swedish volunteers and *krigsbarn* far more room, and a Soviet border provocation
at Pummanki appears only in Swedish. Suggestions for editors are listed below.

## 2:40 — How it works / scale
- 862,076 versions with real edit times in a **system-versioned table**
  (`system_versioning_insert_history`).
- Passages through time: a **vector index on a system-versioned table**.
- 12.2 GB of history text in **MariaDB S3 tables** on object storage. `ALTER TABLE … ENGINE=S3`,
  and it is still SQL.
> "Everything you saw is MariaDB. Gemini only writes the words."

## Backup questions
- *Mitä Wikipedia kertoi Lapuanliikkeestä vuonna 2007?* (Finnish, as of 2007)
- Drag the scrubber to 2006 and ask *Who was Urho Kekkonen?*, then drag to today and ask again.
- *How did Finland's NATO membership come about?* (only exists in recent years: try it as of 2015)
