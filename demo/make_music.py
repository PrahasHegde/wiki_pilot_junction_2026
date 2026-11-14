"""An original background track for the demo, synthesized in code (no samples, no licensing issues).

    python demo/make_music.py 230        # length in seconds -> demo/raw/music.wav

112 BPM, A minor, Am–F–C–G. Layers: soft pads, a plucked 16th-note arpeggio with echo, a pulsing
bass, and drums (kick, off-beat hats, claps) with a riser every 16 bars. Gentle intro, drum-less
outro that fades out.
"""
import sys, wave
import numpy as np

SR = 44100
BPM = 112
BEAT = 60 / BPM
BAR = 4 * BEAT
length = float(sys.argv[1]) if len(sys.argv) > 1 else 230.0
out_path = sys.argv[2] if len(sys.argv) > 2 else "demo/raw/music.wav"
N = int(length * SR) + SR
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(7)

def hz(midi): return 440.0 * 2 ** ((midi - 69) / 12)

# A minor: Am – F – C – G (two bars each)
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
ROOTS = [45, 41, 48, 43]
n_bars = int(length / BAR) + 1
INTRO, OUTRO = 8, max(10, n_bars - 4)        # drums enter after 8 bars, leave for the last 4


def add(buf, start, sig, gain=1.0):
    i = int(start * SR)
    if i >= N: return
    seg = sig[: N - i]
    buf[i:i + len(seg)] += gain * seg


def env(n, a=0.01, r=0.2, sustain=True):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4))
    if sustain:
        rel = np.clip((n / SR - t) / max(r, 1e-4), 0, 1)
        return e * rel
    return e * np.exp(-t / r)


def soft_saw(f, n, harmonics=7, detune=0.0):
    t = np.arange(n) / SR
    s = np.zeros(n)
    for k in range(1, harmonics + 1):
        s += np.sin(2 * np.pi * f * (1 + detune) * k * t + k) / k ** 1.3
    return s

# ---------------------------------------------------------------------------------------- pads
for bar in range(0, n_bars, 2):
    chord = CHORDS[(bar // 2) % 4]
    dur = 2 * BAR
    n = int(dur * SR) + int(0.6 * SR)
    pad = np.zeros(n)
    for note in chord:
        f = hz(note)
        pad += soft_saw(f, n, 6, -0.003) + soft_saw(f, n, 6, +0.003)
    pad *= env(n, a=0.6, r=0.9)
    level = 0.05 if bar < INTRO else 0.04
    add(L, bar * BAR, pad, level); add(R, bar * BAR, pad, level * 0.92)

# ------------------------------------------------------------------------------------ arpeggio
pattern = [0, 1, 2, 1, 2, 0, 1, 2]                   # chord-tone indices per 16th
for bar in range(n_bars):
    if bar >= n_bars - 1: break
    chord = CHORDS[(bar // 2) % 4]
    for step in range(16):
        tone = chord[pattern[step % 8]] + (12 if step % 4 == 3 else 12)
        f = hz(tone)
        n = int(0.35 * SR)
        t = np.arange(n) / SR
        pl = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)) * np.exp(-t / 0.11)
        vel = 0.075 * (1.0 if step % 4 == 0 else 0.7) * (0.6 if bar < 4 else 1.0)
        start = bar * BAR + step * BEAT / 4
        add(L, start, pl, vel * 0.9); add(R, start, pl, vel * 0.6)
        # echo (3/16) panned the other way
        add(R, start + 3 * BEAT / 4, pl, vel * 0.35); add(L, start + 6 * BEAT / 4, pl, vel * 0.15)

# ---------------------------------------------------------------------------------------- bass
for bar in range(INTRO // 2, n_bars):
    if bar >= OUTRO + 2: break
    root = ROOTS[(bar // 2) % 4]
    f = hz(root)
    for eighth in range(8):
        n = int(BEAT / 2 * SR)
        t = np.arange(n) / SR
        b = (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)) * env(n, a=0.005, r=0.06)
        add(L, bar * BAR + eighth * BEAT / 2, b, 0.16); add(R, bar * BAR + eighth * BEAT / 2, b, 0.16)

# --------------------------------------------------------------------------------------- drums
def kick():
    n = int(0.32 * SR); t = np.arange(n) / SR
    f = 45 + 95 * np.exp(-t / 0.045)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.13)


def hat(open_=False):
    n = int((0.18 if open_ else 0.05) * SR)
    x = rng.standard_normal(n); x = np.diff(x, prepend=0)
    return x / 9 * np.exp(-np.arange(n) / SR / (0.06 if open_ else 0.015))


def clap():
    n = int(0.22 * SR); t = np.arange(n) / SR
    x = np.diff(rng.standard_normal(n), prepend=0)
    e = np.exp(-t / 0.07) * (1 + 0.6 * ((t > 0.01) & (t < 0.02)))
    return x / 3 * e


K, CL = kick(), clap()
for bar in range(INTRO, OUTRO):
    for beat in range(4):
        s = bar * BAR + beat * BEAT
        add(L, s, K, 0.42); add(R, s, K, 0.42)
        h = hat(open_=(beat == 3 and bar % 2 == 1))
        add(L, s + BEAT / 2, h, 0.07); add(R, s + BEAT / 2, h, 0.09)
        if beat in (1, 3) and bar >= INTRO + 8:
            add(L, s, CL, 0.12); add(R, s, CL, 0.12)
    if bar % 16 == 15:                                # riser into the next section
        n = int(BAR * SR); t = np.arange(n) / SR
        x = np.diff(rng.standard_normal(n), prepend=0) * (t / (BAR)) ** 2 / 5
        add(L, bar * BAR, x, 0.18); add(R, bar * BAR, x, 0.18)

# ------------------------------------------------------------------------------ master + export
mix = np.stack([L, R], axis=1)[: int(length * SR)]
fade_in, fade_out = int(2.5 * SR), int(5 * SR)
mix[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
mix[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None]
mix = np.tanh(mix * 1.4) / np.tanh(1.4)               # gentle glue / saturation
mix *= 0.89 / max(1e-9, np.abs(mix).max())
pcm = (mix * 32767).astype(np.int16)
with wave.open(out_path, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print(f"wrote {out_path}: {length:.0f}s, {BPM} BPM, {n_bars} bars")
