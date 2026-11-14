// Voice in (Gemini transcription, any language) and voice out (Gemini speech).
import { useEffect, useRef, useState } from "react";
import { Mic, Square, Volume2, VolumeX } from "lucide-react";
import { Globe } from "./ui";

const toB64 = (blob) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.readAsDataURL(blob); });

export function MicButton({ onText, size = 17, title = "Ask by voice (Gemini)" }) {
  const [state, setState] = useState("idle"); // idle | rec | busy | error
  const rec = useRef(null), chunks = useRef([]), timer = useRef(null);
  const [secs, setSecs] = useState(0);
  const stop = () => rec.current && rec.current.state === "recording" && rec.current.stop();
  const start = async () => {
    if (state === "rec") return stop();
    if (state === "busy") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.onstop = async () => {
        clearInterval(timer.current); stream.getTracks().forEach((t) => t.stop());
        setState("busy");
        try {
          const blob = new Blob(chunks.current, { type: mr.mimeType || "audio/webm" });
          const r = await fetch("/api/voice", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio: await toB64(blob), mime: blob.type }) }).then((x) => x.json());
          setState("idle");
          if (r.text && r.text.trim()) onText(r.text.trim(), r.language);
        } catch { setState("error"); setTimeout(() => setState("idle"), 2000); }
      };
      rec.current = mr; mr.start(); setState("rec"); setSecs(0);
      timer.current = setInterval(() => setSecs((s) => { if (s >= 29) stop(); return s + 1; }), 1000);
    } catch { setState("error"); setTimeout(() => setState("idle"), 2500); }
  };
  useEffect(() => () => clearInterval(timer.current), []);
  return (
    <button type="button" className={"mic " + state} onClick={start} title={state === "rec" ? "Stop and ask" : state === "error" ? "Microphone not available" : title} aria-label={title}>
      {state === "busy" ? <Globe size={size} className="tight" /> : state === "rec" ? <><Square size={size - 4} fill="currentColor" /><span className="mic-secs">{secs}s</span></> : <Mic size={size} />}
    </button>
  );
}

// Plays text with Gemini speech. One player at a time across the app.
let current = null;
export function ListenButton({ getText, label = "Listen" }) {
  const [state, setState] = useState("idle"); // idle | busy | playing
  const audio = useRef(null);
  const stop = () => { audio.current?.pause(); setState("idle"); };
  const go = async () => {
    if (state === "playing" || state === "busy") return stop();
    if (current && current !== stop) current();
    setState("busy");
    try {
      const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: getText() }) });
      const url = URL.createObjectURL(await r.blob());
      const a = new Audio(url); audio.current = a; current = stop;
      a.onended = () => setState("idle");
      await a.play(); setState("playing");
    } catch { setState("idle"); }
  };
  useEffect(() => () => audio.current?.pause(), []);
  return (
    <button className={"btn listen " + state} onClick={go}>
      {state === "busy" ? <><Globe size={15} className="tight" /> Preparing audio…</> : state === "playing" ? <><VolumeX size={14} /> Stop</> : <><Volume2 size={14} /> {label}</>}
      {state === "playing" && <span className="eq"><i /><i /><i /></span>}
    </button>
  );
}
