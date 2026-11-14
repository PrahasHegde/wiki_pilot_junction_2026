"""Cut the waits out of the raw recording, lay the Gemini narration on top, export MP4.

    python demo/make_video.py        # reads demo/raw/timeline.json -> demo/WikiPilot_demo.mp4
"""
import json, os, subprocess, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
OUT = os.path.join(HERE, "WikiPilot_demo.mp4")
FFMPEG = shutil.which("ffmpeg") or "ffmpeg"

tl = json.load(open(os.path.join(RAW, "timeline.json")))
cuts = sorted((a, b) for a, b, _ in tl["cuts"])
end = tl["end"]


# The video file starts a little after the script's clock (T0): measure the offset and align.
_dur = float(subprocess.run([shutil.which("ffprobe") or "ffprobe", "-v", "error", "-show_entries", "format=duration",
                             "-of", "csv=p=0", tl["video"]], capture_output=True, text=True).stdout.strip())
OFFSET = max(0.0, end - _dur)
cuts = [(a - OFFSET, b - OFFSET) for a, b in cuts]
end = end - OFFSET


def mapped(t):
    """Script time -> time in the cut video."""
    t -= OFFSET
    return t - sum(min(b, t) - a for a, b in cuts if a < t)


# 1. video: keep everything outside the cut intervals, re-time, upscale to 1080p
keep = " + ".join(f"between(t,{a:.3f},{b:.3f})" for a, b in cuts) or "0"
final_len = end - sum(b - a for a, b in cuts)
fade_out = max(0, final_len - 1.0)
vf = (f"select='not({keep})',setpts=N/FRAME_RATE/TB,"
      f"scale=1920:1080:flags=lanczos,fps=30,fade=t=in:st=0:d=0.8,fade=t=out:st={fade_out:.2f}:d=1.0,format=yuv420p")

# 2. audio: each scene's narration at its (mapped) start
inputs, filters, labels = [], [], []
for i, s in enumerate(tl["scenes"]):
    path = tl["narration"][s["key"]]
    inputs += ["-i", path]
    delay = int(max(0, mapped(s["t_raw"]) + 0.25) * 1000)
    filters.append(f"[{i + 1}:a]aresample=48000,adelay={delay}|{delay}[a{i}]")
    labels.append(f"[a{i}]")
af = ";".join(filters) + f";{''.join(labels)}amix=inputs={len(labels)}:normalize=0,apad,atrim=0:{final_len:.2f},afade=t=out:st={fade_out:.2f}:d=1.0[aout]"

cmd = [FFMPEG, "-y", "-i", tl["video"], *inputs,
       "-filter_complex", f"[0:v]{vf}[vout];{af}",
       "-map", "[vout]", "-map", "[aout]",
       "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-c:a", "aac", "-b:a", "192k",
       "-movflags", "+faststart", OUT]
print(f"raw {end:.0f}s (offset {OFFSET:.2f}s), {len(cuts)} cuts -> {final_len:.0f}s")
subprocess.run(cmd, check=True)
print("wrote", OUT, f"({os.path.getsize(OUT) / 1e6:.1f} MB)")
