"""Render checks on a finished video. Writes check.json and contact sheets, exits 1 on a failed check.

Usage: check.py RESOLVED_JSON [VIDEO]
Checks length, size, audio, flat frames, near-still stretches and loudness. The contact sheets
(one frame per second) are for your own eyes: read them, because no script judges taste.
"""
import json, os, re, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw

if len(sys.argv) < 2:
    sys.exit(__doc__)
CFG = json.load(open(sys.argv[1]))
P = CFG["paths"]
VIDEO = sys.argv[2] if len(sys.argv) > 2 else P["video"]
TIMELINE = json.load(open(P["timeline"]))
LIMITS = CFG["checks"]
W, H, FPS = CFG["output"]["width"], CFG["output"]["height"], CFG["fps"]
report = {"video": VIDEO, "checks": [], "contactSheets": []}
failed = False


def record(name, ok, detail, severity="fail"):
    global failed
    status = "PASS" if ok else ("FAIL" if severity == "fail" else "WARN")
    if not ok and severity == "fail":
        failed = True
    report["checks"].append({"name": name, "status": status, "detail": detail})
    print(f"{status:4}  {name}: {detail}")


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


probe = json.loads(run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", VIDEO]).stdout or "{}")
streams = probe.get("streams", [])
video = next((s for s in streams if s["codec_type"] == "video"), None)
audio = next((s for s in streams if s["codec_type"] == "audio"), None)
if not video:
    record("video stream", False, "no video stream found")
    sys.exit(1)

duration = float(probe["format"]["duration"])
expected = TIMELINE["seconds"]
record("length", abs(duration - expected) < 0.15, f"{duration:.2f} s, expected {expected:.2f} s")
record("size", (video["width"], video["height"]) == (W, H), f"{video['width']}x{video['height']}, expected {W}x{H}")
num, den = map(int, video["r_frame_rate"].split("/"))
record("frame rate", abs(num / den - FPS) < 0.01, f"{num / den:.2f} fps, expected {FPS}")
if CFG["audio"]["enabled"]:
    record("audio stream", audio is not None, "present" if audio else "missing")

# Decode a small grayscale copy of every frame to find flat frames and frozen stretches.
sw, sh = 160, max(2, int(160 * H / W) // 2 * 2)
raw = subprocess.run(
    ["ffmpeg", "-v", "error", "-i", VIDEO, "-vf", f"scale={sw}:{sh},format=gray", "-f", "rawvideo", "-"],
    capture_output=True,
).stdout
frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, sh, sw).astype(np.float32)
spread = frames.reshape(len(frames), -1).std(axis=1)
flat = np.where(spread < 1.0)[0]
exempt_from = TIMELINE["endStart"] if TIMELINE["hasEnd"] else None
bad = [int(i) for i in flat if exempt_from is None or i < exempt_from or i >= TIMELINE["endCardStart"] + 4]
record(
    "no flat frames",
    len(bad) <= LIMITS["maxFlatFrames"],
    "none" if not bad else f"{len(bad)} flat frames, first at {bad[0] / FPS:.2f} s",
)
if TIMELINE["hasEnd"]:
    cut = [int(i) for i in flat if TIMELINE["endStart"] <= i < TIMELINE["endCardStart"] + 4]
    report["designedDip"] = [round(i / FPS, 2) for i in cut[:1]]

diff = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2))
still = diff < 0.02
longest = run_start = 0
for i, s in enumerate(still):
    run_start = run_start + 1 if s else 0
    longest = max(longest, run_start)
record(
    "no frozen stretch",
    longest / FPS <= LIMITS["maxStillSeconds"],
    f"longest near-still run {longest / FPS:.1f} s, limit {LIMITS['maxStillSeconds']} s",
    "warn",
)
report["motionScore"] = round(float(diff.mean()), 3)
print(f"      motion score {report['motionScore']} (mean frame difference out of 255; a white UI demo reads low)")

if audio:
    out = run(["ffmpeg", "-nostats", "-i", VIDEO, "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr
    summary = out[out.rfind("Summary:"):]
    lufs = re.search(r"I:\s+(-?[\d.]+) LUFS", summary)
    peak = re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary)
    if lufs and peak:
        report["lufs"], report["truePeakDb"] = float(lufs.group(1)), float(peak.group(1))
        record("true peak", report["truePeakDb"] <= LIMITS["minPeakDb"], f"{report['truePeakDb']} dBTP, limit {LIMITS['minPeakDb']}")
        print(f"      integrated loudness {report['lufs']} LUFS")
    clip = run(["ffmpeg", "-nostats", "-i", VIDEO, "-af", "astats=metadata=0", "-f", "null", "-"]).stderr
    clipped = [int(n) for n in re.findall(r"Number of clipped samples:\s*(\d+)", clip)]
    if clipped:
        record("no clipped samples", sum(clipped) == 0, f"{sum(clipped)} clipped samples")

sheet_dir = os.path.join(P["out"], "contact")
os.makedirs(sheet_dir, exist_ok=True)
for old in os.listdir(sheet_dir):
    os.remove(os.path.join(sheet_dir, old))
subprocess.run(["ffmpeg", "-v", "error", "-i", VIDEO, "-vf", "fps=1,scale=480:-2", f"{sheet_dir}/s%04d.png"], check=True)
thumbs = sorted(f for f in os.listdir(sheet_dir) if f.startswith("s"))
cols, rows = 4, 4
for page in range(0, len(thumbs), cols * rows):
    batch = thumbs[page: page + cols * rows]
    first = Image.open(os.path.join(sheet_dir, batch[0]))
    tw, th = first.size
    sheet = Image.new("RGB", (cols * tw, rows * th), "#222")
    for n, name in enumerate(batch):
        img = Image.open(os.path.join(sheet_dir, name)).convert("RGB")
        ImageDraw.Draw(img).text((8, 6), f"{page + n}s", fill="#ff3b30")
        sheet.paste(img, ((n % cols) * tw, (n // cols) * th))
    path = os.path.join(P["out"], f"contact-{page // (cols * rows) + 1}.jpg")
    sheet.save(path, quality=88)
    report["contactSheets"].append(path)
for name in thumbs:
    os.remove(os.path.join(sheet_dir, name))
os.rmdir(sheet_dir)
print("      contact sheets (one frame per second), read them:")
for path in report["contactSheets"]:
    print("       ", path)

json.dump(report, open(os.path.join(P["out"], "check.json"), "w"), indent=1)
sys.exit(1 if failed else 0)
