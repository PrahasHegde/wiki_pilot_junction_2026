"""Wikitext -> readable blocks, and blocks -> passages for retrieval.

Not MediaWiki's parser: templates, tables, references and files are dropped, links become plain
words, headings and lists are kept. Good enough to read, compare and embed — and deterministic,
which matters: the same wikitext always gives the same passages, so unchanged passages keep
their identity (hash) from one year to the next.
"""
import hashlib, re

_SKIP_SECTIONS = re.compile(r"^(lähteet|aiheesta muualla|kirjallisuutta|viitteet|katso myös|"
                            r"lähdeluettelo|lisätietoa|aiheesta muualla|ulkoiset linkit|huomautukset)$", re.I)


def _drop_nested(text, start, end):
    out, depth, i, n = [], 0, 0, len(text)
    ls, le = len(start), len(end)
    while i < n:
        if text.startswith(start, i):
            depth += 1; i += ls
        elif depth and text.startswith(end, i):
            depth -= 1; i += le
        else:
            if not depth:
                j = i
                # copy a run of ordinary characters at once
                while j < n and text[j] != start[0] and text[j] != end[0]:
                    j += 1
                if j == i:
                    out.append(text[i]); i += 1
                else:
                    out.append(text[i:j]); i = j
            else:
                i += 1
    return "".join(out)


_FILE = re.compile(r"\[\[(?:Tiedosto|Kuva|File|Image|Luokka|Category|Media):[^\[\]]*(?:\[\[[^\]]*\]\][^\[\]]*)*\]\]", re.I)


def clean(wikitext):
    """Wikitext -> list of (kind, text): kind is 'h' (section), 'h3' (subsection), 'li' or 'p'."""
    if not wikitext:
        return []
    t = re.sub(r"<!--.*?-->", "", wikitext, flags=re.S)
    t = re.sub(r"<ref[^>/]*/>", "", t)
    t = re.sub(r"<ref[^>]*>.*?</ref>", "", t, flags=re.S)
    t = re.sub(r"<(gallery|timeline|math|score|syntaxhighlight)[^>]*>.*?</\1>", "", t, flags=re.S | re.I)
    t = _drop_nested(t, "{{", "}}")
    t = _drop_nested(t, "{|", "|}")
    t = _FILE.sub("", t)
    t = re.sub(r"\[\[([^\]|]*)\|([^\]]*)\]\]", r"\2", t)
    t = re.sub(r"\[\[([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\[https?://\S+ ([^\]]*)\]", r"\1", t)
    t = re.sub(r"\[https?://\S+\]", "", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("'''", "").replace("''", "").replace("&nbsp;", " ")
    blocks = []
    for line in t.split("\n"):
        line = line.strip()
        if not line or line.startswith("__"):
            continue
        h = re.match(r"^(=+)\s*(.*?)\s*=+$", line)
        if h:   # == Section == -> "h";  === Subsection === and deeper -> "h3"
            blocks.append(("h" if len(h.group(1)) <= 2 else "h3", h.group(2)))
        elif line[0] in "*#":
            s = line.lstrip("*#: ").strip()
            if s:
                blocks.append(("li", s))
        elif line[0] not in "|!:;{}":
            blocks.append(("p", re.sub(r"\s+", " ", line)))
    return blocks


def plain(wikitext):
    return "\n".join(t for _, t in clean(wikitext))


def passages(title, blocks, target=900, hard=1600):
    """Group blocks into passages of ~target characters, never across a section heading.
    Returns list of (section, text). Reference/link sections are skipped."""
    out, section, buf, skipping = [], "", [], False

    def flush():
        if buf:
            text = "\n".join(buf).strip()
            if len(text) >= 80:
                out.append((section, text))
        buf.clear()

    for kind, text in blocks:
        if kind in ("h", "h3"):
            flush()
            section = text[:250]
            skipping = bool(_SKIP_SECTIONS.match(text.strip()))
            continue
        if skipping:
            continue
        if len(text) > hard:                       # split very long paragraphs on sentences
            flush()
            cur = ""
            for s in re.split(r"(?<=[.!?])\s+", text):
                if cur and len(cur) + len(s) > target:
                    buf.append(cur); flush(); cur = ""
                cur = (cur + " " + s).strip()
            if cur:
                buf.append(cur)
            continue
        if buf and sum(len(b) for b in buf) + len(text) > target:
            flush()
        buf.append(("• " if kind == "li" else "") + text)
    flush()
    return out


def chash(page_id, text):
    return hashlib.sha1(f"{page_id}\x00{text}".encode()).hexdigest()[:16]


def thash(text):
    return hashlib.md5(text.encode()).hexdigest()


def embed_text(title, section, text):
    """What we embed: title and section give the passage its context."""
    return f"{title}" + (f" — {section}" if section else "") + f"\n{text}"
