"""Gemini-powered tools: voice in (speech → text), voice out (text → speech), translation of any
article version, and the editor studio (improve a paragraph; illustrate it, and edit the image)."""
import base64, json, re, time
from concurrent.futures import ThreadPoolExecutor
from . import db, gemini, history, wikitext
from .config import env

STT_MODEL = env("GEMINI_STT_MODEL", "gemini-3.5-flash")
TTS_MODEL = env("GEMINI_TTS_MODEL", "gemini-3.8-flash-tts")
IMAGE_MODEL = env("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image")
BASE = gemini.BASE

LANGS = {"en": "English", "fi": "Finnish", "sv": "Swedish", "de": "German", "fr": "French", "es": "Spanish",
         "et": "Estonian", "ru": "Russian", "hi": "Hindi", "ja": "Japanese", "zh": "Chinese", "ar": "Arabic"}


# ------------------------------------------------------------------------------------- voice in

def transcribe(audio_b64, mime="audio/webm"):
    """Speech in any language -> text, with the language detected."""
    t = time.perf_counter()
    body = {"contents": [{"role": "user", "parts": [
        {"inlineData": {"mimeType": mime.split(";")[0], "data": audio_b64}},
        {"text": "Transcribe this spoken question exactly, in the language it was spoken. "
                 "Fix obvious filler words (um, uh). Return JSON."}]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json", "responseSchema": {
            "type": "OBJECT", "properties": {"text": {"type": "STRING"}, "language": {"type": "STRING", "description": "ISO 639-1 code"}},
            "required": ["text", "language"]}}}
    r = gemini._post(BASE + STT_MODEL + ":generateContent", body)
    out = json.loads("".join(p.get("text", "") for p in r.json()["candidates"][0]["content"]["parts"] if not p.get("thought")))
    out["ms"] = round((time.perf_counter() - t) * 1000)
    out["model"] = STT_MODEL
    return out


# ------------------------------------------------------------------------------------ voice out

def _speakable(text):
    t = re.sub(r"\s?\[\d+(?:\s*,\s*\d+)*\]", "", text)          # citations
    t = re.sub(r"[*_#`>]+", "", t)                              # markdown
    t = re.sub(r"^\s*[-•]\s+", "", t, flags=re.M)
    return re.sub(r"\s+\n", "\n", t).strip()[:2400]


def speak(text, voice="Kore"):
    """Text -> WAV audio (Gemini speech)."""
    body = {"contents": [{"parts": [{"text": _speakable(text)}]}],
            "generationConfig": {"responseModalities": ["AUDIO"],
                                 "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}}}
    r = gemini._post(BASE + TTS_MODEL + ":generateContent", body, timeout=180)
    part = r.json()["candidates"][0]["content"]["parts"][0]["inlineData"]
    data, mime = base64.b64decode(part["data"]), part.get("mimeType", "audio/wav")
    if not mime.startswith("audio/wav"):                         # raw PCM (audio/L16;rate=24000) -> WAV
        import io, wave
        rate = int(re.search(r"rate=(\d+)", mime).group(1)) if "rate=" in mime else 24000
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(data)
        data, mime = buf.getvalue(), "audio/wav"
    return data, mime


# ---------------------------------------------------------------------------------- translation

_tcache = {}
TR_SCHEMA = {"type": "ARRAY", "items": {"type": "STRING"}}


def _translate_batch(texts, lang):
    prompt = (f"Translate each of these {len(texts)} passages from a Finnish Wikipedia article into {LANGS.get(lang, lang)}. "
              "Keep the meaning exact and neutral (it is an encyclopedia); keep names, dates and numbers; keep '• ' list "
              "markers. Return a JSON array with exactly one translated string per input, in the same order.\n\n"
              + json.dumps(texts, ensure_ascii=False))
    out = gemini.generate(prompt, model=gemini.GEMINI_FAST_MODEL, json_schema=TR_SCHEMA, temperature=0.1)
    if not isinstance(out, list) or len(out) != len(texts):     # never misalign paragraphs
        out = [gemini.generate(f"Translate into {LANGS.get(lang, lang)}; reply with the translation only:\n\n{t}",
                               model=gemini.GEMINI_FAST_MODEL, temperature=0.1) for t in texts]
    return out


def translate(pid, at, lang):
    tr = db.Trace()
    m = history.text_at(tr, pid, at)
    if not m:
        return {"error": "The article did not exist yet at that moment."}
    key = (pid, m["rev_id"], lang)
    if key in _tcache:
        return {**_tcache[key], "cached": True, "trace": tr.items}
    blocks = wikitext.clean(m["text"])
    t = time.perf_counter()
    batches, cur, size = [], [], 0                               # ~6k characters per request
    for i, (k, txt) in enumerate(blocks):
        cur.append(i); size += len(txt)
        if size > 4000 or len(cur) >= 30:
            batches.append(cur); cur, size = [], 0
    if cur:
        batches.append(cur)
    out = [None] * len(blocks)
    with ThreadPoolExecutor(16) as ex:
        for idx, res in zip(batches, ex.map(lambda b: _translate_batch([blocks[i][1] for i in b], lang), batches)):
            for i, s in zip(idx, res):
                out[i] = s
    tr.add(f"translate {len(blocks)} paragraphs → {LANGS.get(lang, lang)} with {gemini.GEMINI_FAST_MODEL} "
           f"({len(batches)} parallel requests)", (time.perf_counter() - t) * 1000)
    res = {"lang": lang, "language": LANGS.get(lang, lang), "rev_id": m["rev_id"],
           "blocks": [[k, out[i] or txt] for i, (k, txt) in enumerate(blocks)], "original": [t for _, t in blocks]}
    _tcache[key] = res
    return {**res, "cached": False, "trace": tr.items}


# ----------------------------------------------------------------------------- editor: improve

TASKS = {
    "npov": "Check this paragraph against Wikipedia's neutral point of view (NPOV): loaded or judgemental wording, "
            "unattributed opinions, one-sided framing, weasel words. Rewrite it neutrally, attributing views to their holders.",
    "clarity": "Improve readability and flow for a general reader without changing any facts: shorter sentences, "
               "clear subjects, no jargon left unexplained.",
    "citations": "Find every claim that a Wikipedia reviewer would tag {{lähde?}} (citation needed): numbers, dates, "
                 "quotes, contested or evaluative statements. Keep the text, but insert {{lähde?}} after each such claim.",
    "shorten": "Condense this paragraph to about half its length for a summary or lead section, keeping the key facts.",
}
IMPROVE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "rewrite": {"type": "STRING", "description": "the improved paragraph, in Finnish (the article's language)"},
        "rewrite_en": {"type": "STRING", "description": "an English translation of the improved paragraph"},
        "issues": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "quote": {"type": "STRING", "description": "the exact problematic words from the original (Finnish)"},
            "type": {"type": "STRING", "enum": ["npov", "weasel", "unsourced", "clarity", "length", "other"]},
            "explanation": {"type": "STRING", "description": "in English, one sentence"}},
            "required": ["quote", "type", "explanation"]}},
        "summary": {"type": "STRING", "description": "in English, 1-2 sentences: what was changed and why"},
    },
    "required": ["rewrite", "rewrite_en", "issues", "summary"],
}


def improve(title, text, task):
    t = time.perf_counter()
    out = gemini.generate(
        f"You help an experienced editor of Finnish Wikipedia. Article: “{title}”.\nTask: {TASKS.get(task, TASKS['clarity'])}\n"
        "Follow Wikipedia's policies (NPOV, verifiability, no original research). Never add facts that are not in the "
        "paragraph. Keep the rewrite in Finnish.\n\nParagraph:\n" + text,
        json_schema=IMPROVE_SCHEMA, temperature=0.2)
    out["ms"] = round((time.perf_counter() - t) * 1000)
    out["model"] = gemini.GEMINI_MODEL
    return out


# ---------------------------------------------------------------------------- editor: illustrate

STYLES = {
    "watercolour": "a soft watercolour illustration in the style of a quality encyclopedia plate",
    "map": "a clean historical map illustration with muted colours, clear terrain, borders and arrows; minimal labels",
    "diagram": "a clear explanatory infographic-style diagram with simple shapes and a limited colour palette",
    "line": "a precise black ink line drawing, like a historical textbook engraving",
    "poster": "a bold period-style illustrated poster composition",
}


def image_prompt(title, text, style):
    return gemini.fast(
        "Write one image-generation prompt (in English, max 90 words) for an illustration of this passage from the "
        f"Finnish Wikipedia article “{title}”. Style: {STYLES.get(style, STYLES['watercolour'])}. Depict the setting, "
        "people and objects historically accurately (period clothing, equipment, landscape). No text or captions in "
        "the image unless it is a map. Do not depict identifiable real people's faces in close-up. Reply with the "
        f"prompt only.\n\nPassage:\n{text[:2500]}")


def image(prompt, base_b64=None, base_mime="image/jpeg", style=None):
    """Generate an illustration, or edit `base_b64` according to `prompt`."""
    t = time.perf_counter()
    parts = []
    if base_b64:
        parts.append({"inlineData": {"mimeType": base_mime, "data": base_b64}})
        parts.append({"text": "Edit this image: " + prompt + ". Keep everything else the same."})
    else:
        parts.append({"text": prompt + (f". Style: {STYLES[style]}." if style in STYLES else "")})
    body = {"contents": [{"role": "user", "parts": parts}], "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]}}
    r = gemini._post(BASE + IMAGE_MODEL + ":generateContent", body, timeout=240)
    out_parts = r.json()["candidates"][0]["content"]["parts"]
    img = next((p["inlineData"] for p in out_parts if "inlineData" in p), None)
    note = " ".join(p.get("text", "") for p in out_parts if "text" in p and not p.get("thought")).strip()
    if not img:
        return {"error": note or "The model returned no image. Try rephrasing the prompt."}
    return {"image": img["data"], "mime": img.get("mimeType", "image/png"), "note": note,
            "ms": round((time.perf_counter() - t) * 1000), "model": IMAGE_MODEL, "edited": bool(base_b64)}
