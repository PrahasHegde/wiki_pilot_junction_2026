"""Ask from the command line through the running server:  python scripts/ask_cli.py "question" [YYYY-MM-DD]"""
import json, sys, urllib.parse, requests
q = sys.argv[1]; date = sys.argv[2] if len(sys.argv) > 2 else ""
url = "http://localhost:8765/api/ask?q=" + urllib.parse.quote(q) + (f"&date={date}" if date else "")
event, out = None, ""
with requests.get(url, stream=True, timeout=300) as r:
    r.encoding = "utf-8"
    for line in r.iter_lines(decode_unicode=True):
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            d = json.loads(line[5:])
            if event == "plan": print("PLAN", json.dumps(d, ensure_ascii=False))
            elif event == "sources":
                for s in d: print(f"  [{s['n']}] {s['era']:5} {s['title']} | {s['section']} | {s['text'][:70]!r}")
            elif event == "token": out += d
            elif event == "drift": print(json.dumps(d, ensure_ascii=False, indent=1))
            elif event == "trace": print("TRACE", [(t['label'], t['ms']) for t in d])
            elif event == "error": print("ERROR", d)
print(out)
