"""Original soft score and UI sounds, synthesised here, so nothing needs a licence.

Usage: audio.py RESOLVED_JSON
Reads track.json (click and key events) and timeline.json (length), writes score.wav.
"""
import json, sys, wave
import numpy as np

if len(sys.argv) < 2:
    sys.exit(__doc__)
CFG = json.load(open(sys.argv[1]))
P = CFG["paths"]
TRACK = json.load(open(f"{P['take']}/track.json"))
TIMELINE = json.load(open(P["timeline"]))
A = CFG["audio"]
FPS = CFG["fps"]
SR = 48000
duration = TIMELINE["seconds"]
N = int(SR * duration)
rng = np.random.default_rng(CFG["seed"])
BEAT = 60 / A["bpm"]

note = lambda midi: 440 * 2 ** ((midi - 69) / 12)
CHORDS = A.get("chords") or [[48, 55, 64, 71], [45, 52, 60, 67], [41, 53, 60, 69], [43, 50, 59, 67]]
ARP = [0, 2, 3, 2, 1, 3, 2, 3]


def tone(freq, seconds, harmonics, attack, release):
    n = int(SR * seconds)
    t = np.arange(n) / SR
    wave_ = sum(a * np.sin(2 * np.pi * freq * h * t) for h, a in harmonics)
    env = np.minimum(1, t / attack) * np.minimum(1, (seconds - t) / release)
    return wave_ * env


def add(bus, start, signal, gain=1.0):
    i = int(start * SR)
    if i >= len(bus) or i < 0:
        return
    end = min(len(bus), i + len(signal))
    bus[i:end] += signal[: end - i] * gain


pad, pluck, bass = np.zeros(N), np.zeros(N), np.zeros(N)
bar = BEAT * 4
for index in range(int(duration / bar) + 1):
    chord = CHORDS[index % len(CHORDS)]
    start = index * bar
    for midi in chord:
        add(pad, start, tone(note(midi), bar + 0.7, [(1, 1), (2, 0.28), (3, 0.08)], 0.45, 0.8), 0.05)
    add(bass, start, tone(note(chord[0] - 12), bar * 0.9, [(1, 1), (2, 0.2)], 0.02, 0.4), 0.12)
    for step in range(8):
        midi = chord[ARP[step] % len(chord)] + 12
        length = 0.42
        t = np.arange(int(SR * length)) / SR
        body = tone(note(midi), length, [(1, 1), (2, 0.34), (3, 0.12)], 0.003, 0.05) * np.exp(-t * 8.5)
        add(pluck, start + step * BEAT / 2, body, 0.07 + 0.02 * (step % 2 == 0))

delay = np.zeros(N)
lag = int(SR * BEAT * 0.75)
delay[lag:] = pluck[:-lag] * 0.3
music_l = pad + bass + pluck + delay * 0.9
music_r = pad + bass + pluck * 0.92 + np.roll(delay, 240)

fade = np.ones(N)
fade[: int(SR * 0.5)] = np.linspace(0, 1, int(SR * 0.5))
tail = min(N, int(SR * 1.3))
fade[-tail:] = np.linspace(1, 0, tail) ** 1.6
music = np.stack([music_l, music_r]) * fade * 0.8 * (1.0 if A.get("music", True) else 0.0)

fx = np.zeros(N)
for item in TRACK["events"]:
    at = item["frame"] / FPS
    if item["kind"] == "click":
        n = int(SR * 0.05)
        t = np.arange(n) / SR
        noise = rng.normal(0, 1, n)
        body = (np.sin(2 * np.pi * 1500 * t) * 0.6 + np.sin(2 * np.pi * 420 * t) + noise * 0.25) * np.exp(-t * 170)
        add(fx, at, body, 0.15)
        add(fx, at + 0.083, body, 0.08)
    else:
        n = int(SR * 0.022)
        t = np.arange(n) / SR
        body = (rng.normal(0, 1, n) * 0.5 + np.sin(2 * np.pi * (900 + rng.uniform(-120, 160)) * t)) * np.exp(-t * 300)
        add(fx, at, body, rng.uniform(0.018, 0.034))

marks = dict(TRACK["marks"])
marks["@endcard"] = TIMELINE["endCardStart"]
for accent in A["accents"]:
    if accent["mark"] == "@endcard" and not TIMELINE["hasEnd"]:
        continue
    at = (marks[accent["mark"]] + accent.get("offset", 0)) / FPS
    n = int(SR * 0.7)
    t = np.arange(n) / SR
    add(fx, at, np.sin(2 * np.pi * (92 + 40 * np.exp(-t * 24)) * t) * np.exp(-t * 6.5), accent.get("gain", 0.34))

mix = music * A["musicGain"] + np.stack([fx, fx]) * A["fxGain"]
mix = np.tanh(mix) * 0.86
pcm = (mix.T * 32767).astype(np.int16)
with wave.open(P["score"], "wb") as out:
    out.setnchannels(2)
    out.setsampwidth(2)
    out.setframerate(SR)
    out.writeframes(pcm.tobytes())
print("wrote", P["score"], f"{duration:.1f}s")
