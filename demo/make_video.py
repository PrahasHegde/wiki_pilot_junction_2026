"""Edit the raw recording into the final demo (v2): cut the waits, add eased camera zooms, lay the
Gemini narration and the original music (ducked under the voice), normalise loudness, export MP4.

    python demo/make_video.py        # reads demo/raw/timeline.json -> demo/WikiPilot_demo.mp4
"""
import json, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
OUT = os.path.join(HERE, "WikiPilot_demo.mp4")
FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = shutil.which("ffprobe") or "ffprobe"

tl = json.load(open(os.path.join(RAW, "timeline.json")))
VW, VH = tl["size"]
SCALE = tl.get("scale", 1.0)                       # CSS px -> video px

# The video file starts a little after the script's clock: measure and align.
dur = float(subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", tl["video"]],
                           capture_output=True, text=True).stdout.strip())
OFFSET = max(0.0, tl["end"] - dur)
cuts = sorted((a - OFFSET, b - OFFSET) for a, b, _ in tl["cuts"])
end = tl["end"] - OFFSET
final_len = end - sum(b - a for a, b in cuts)


def mapped(t):
    """Script time -> time in the cut video."""
    t -= OFFSET
    return t - sum(min(b, t) - a for a, b in cuts if a < t)


# ------------------------------------------------------------------------- video: cuts + zooms
keep = " + ".join(f"between(t,{a:.3f},{b:.3f})" for a, b in cuts) or "0"
RAMP = 0.65
zterms, xterms, yterms = [], [], []
for zm in tl.get("zooms", []):
    a, b = mapped(zm["a"]), mapped(zm["b"])
    u = f"clip(min((it-{a:.3f})/{RAMP},({b:.3f}-it)/{RAMP}),0,1)"
    s = f"({u}*{u}*(3-2*{u}))"                      # smoothstep ease in/out
    zterms.append(f"{zm['z'] - 1:.3f}*{s}")
    xterms.append(f"{s}*({zm['cx'] * SCALE:.1f}-{VW / 2:.1f})")
    yterms.append(f"{s}*({zm['cy'] * SCALE:.1f}-{VH / 2:.1f})")
zexpr = "1+" + "+".join(zterms) if zterms else "1"
cx = f"({VW / 2:.1f}+" + "+".join(xterms) + ")" if xterms else f"{VW / 2:.1f}"
cy = f"({VH / 2:.1f}+" + "+".join(yterms) + ")" if yterms else f"{VH / 2:.1f}"
fade_out = max(0, final_len - 1.2)
vf = (f"crop={VW}:{VH}:0:0,select='not({keep})',setpts=N/FRAME_RATE/TB,"
      f"zoompan=z='{zexpr}':x='max(0,min(iw-iw/zoom,{cx}-iw/zoom/2))':y='max(0,min(ih-ih/zoom,{cy}-ih/zoom/2))'"
      f":d=1:s={VW}x{VH}:fps=25,"
      f"scale=1920:1080:flags=lanczos,fps=30,fade=t=in:st=0:d=0.6,fade=t=out:st={fade_out:.2f}:d=1.2,format=yuv420p")

# --------------------------------------------------------------------------------- music track
music = os.path.join(RAW, "music.wav")
subprocess.run([sys.executable, os.path.join(HERE, "make_music.py"), f"{final_len + 1:.1f}", music], check=True)

# ------------------------------------------------------------------- audio: narration + music mix
inputs, filters, labels = [], [], []
for i, s in enumerate(tl["scenes"]):
    inputs += ["-i", tl["narration"][s["key"]]]
    delay = int(max(0, mapped(s["t_raw"]) + 0.2) * 1000)
    filters.append(f"[{i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={delay}|{delay}[n{i}]")
    labels.append(f"[n{i}]")
m = len(tl["scenes"]) + 1
inputs += ["-i", music]
af = (";".join(filters) +
      f";{''.join(labels)}amix=inputs={len(labels)}:normalize=0,apad,atrim=0:{final_len:.2f}[narr]"
      f";[narr]asplit=2[voice][key]"
      f";[{m}:a]aresample=48000,volume=0.6[mus]"
      f";[mus][key]sidechaincompress=threshold=0.02:ratio=9:attack=25:release=550:makeup=1[duck]"
      f";[voice][duck]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,"
      f"afade=t=in:st=0:d=0.8,afade=t=out:st={fade_out:.2f}:d=1.2[aout]")

cmd = [FFMPEG, "-y", "-loglevel", "error", "-stats", "-i", tl["video"], *inputs,
       "-filter_complex", f"[0:v]{vf}[vout];{af}",
       "-map", "[vout]", "-map", "[aout]", "-t", f"{final_len:.2f}",
       "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-c:a", "aac", "-b:a", "192k",
       "-movflags", "+faststart", OUT]
print(f"raw {end:.0f}s (offset {OFFSET:.2f}s), {len(cuts)} cuts, {len(zterms)} zooms -> {final_len:.0f}s")
subprocess.run(cmd, check=True)
print("wrote", OUT, f"({os.path.getsize(OUT) / 1e6:.1f} MB)")
