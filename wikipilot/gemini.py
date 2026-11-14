"""Gemini over plain REST: embeddings, JSON generation and streamed generation."""
import json, time, random
import requests
from .config import GEMINI_API_KEY, GEMINI_MODEL, GEMINI_FAST_MODEL, GEMINI_EMBED_MODEL, EMBED_DIM

BASE = "https://generativelanguage.googleapis.com/v1beta/models/"
_session = requests.Session()


def _post(url, body, timeout=120, stream=False):
    for attempt in range(8):
        try:
            r = _session.post(url, params={"key": GEMINI_API_KEY, **({"alt": "sse"} if stream else {})},
                              json=body, timeout=timeout, stream=stream)
        except requests.RequestException:
            time.sleep(min(30, 2 ** attempt) + random.random())
            continue
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(min(60, 2 ** attempt) + random.random())
            continue
        if r.status_code != 200:
            raise RuntimeError(f"Gemini {r.status_code}: {r.text[:500]}")
        return r
    raise RuntimeError("Gemini: too many retries")


def embed(texts, task="RETRIEVAL_DOCUMENT", model=None):
    """Embed texts (100 per call). Returns a list of EMBED_DIM-float vectors."""
    model = model or GEMINI_EMBED_MODEL
    out = []
    for i in range(0, len(texts), 100):
        part = texts[i:i + 100]
        body = {"requests": [{"model": "models/" + model,
                              "content": {"parts": [{"text": t[:12000]}]},
                              "taskType": task, "outputDimensionality": EMBED_DIM} for t in part]}
        r = _post(BASE + model + ":batchEmbedContents", body)
        out += [e["values"] for e in r.json()["embeddings"]]
    return out


def embed_query(text, model=None):
    return embed([text], task="RETRIEVAL_QUERY", model=model)[0]


def _body(prompt, system=None, json_schema=None, temperature=0.2, thinking=None):
    body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": temperature}}
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    if json_schema is not None:
        body["generationConfig"]["responseMimeType"] = "application/json"
        if json_schema:
            body["generationConfig"]["responseSchema"] = json_schema
    if thinking is not None:
        body["generationConfig"]["thinkingConfig"] = {"thinkingBudget": thinking}
    return body


def generate(prompt, system=None, model=None, json_schema=None, temperature=0.2):
    """One answer. With json_schema (a dict, or {} for free-form JSON), returns parsed JSON."""
    model = model or GEMINI_MODEL
    r = _post(BASE + model + ":generateContent", _body(prompt, system, json_schema, temperature))
    j = r.json()
    try:
        text = "".join(p.get("text", "") for p in j["candidates"][0]["content"]["parts"]
                       if not p.get("thought"))
    except (KeyError, IndexError):
        raise RuntimeError("Gemini returned no text: " + json.dumps(j)[:400])
    if json_schema is not None:
        text = text.strip()
        if text.startswith("```"):
            text = text.strip("`").split("\n", 1)[1]
        return json.loads(text)
    return text


def fast(prompt, system=None, json_schema=None):
    return generate(prompt, system, model=GEMINI_FAST_MODEL, json_schema=json_schema, temperature=0.1)


def stream(prompt, system=None, model=None, temperature=0.3):
    """Yield text pieces as Gemini writes them."""
    model = model or GEMINI_MODEL
    r = _post(BASE + model + ":streamGenerateContent", _body(prompt, system, None, temperature),
              timeout=300, stream=True)
    r.encoding = "utf-8"
    for line in r.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data:"):
            continue
        try:
            j = json.loads(line[5:])
        except ValueError:
            continue
        for c in j.get("candidates", []):
            for p in c.get("content", {}).get("parts", []):
                if p.get("text") and not p.get("thought"):
                    yield p["text"]
