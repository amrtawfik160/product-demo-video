"""Turns raw frames plus track.json into the final cut: camera, cursor, captions, end card.

Usage: film.py RESOLVED_JSON [--plan] [--audio FILE] [--only 12,340,900]
  --plan   write timeline.json (length, end card start) and stop
  --only   render those frames as JPEGs into <out>/preview and stop
"""
import json, math, os, subprocess, sys
from multiprocessing import Pool
from PIL import Image

args = sys.argv[1:]
if not args:
    sys.exit(__doc__)
CFG = json.load(open(args[0]))


def flag(name, default=None):
    return args[args.index(name) + 1] if name in args else default


P = CFG["paths"]
TRACK = json.load(open(f"{P['take']}/track.json"))
FPS = CFG["fps"]
W, H = CFG["output"]["width"], CFG["output"]["height"]
K = CFG["layout"]["scale"]
VW, VH, DPR = TRACK["view"]["width"], TRACK["view"]["height"], TRACK["dpr"]
MARKS = TRACK["marks"]
RECTS = TRACK["rects"]
RAW_TOTAL = TRACK["total"]
END = CFG["end"]
CAPS = CFG["captions"]
DRIFT = CFG["cameraDrift"]

if END:
    END_START = RAW_TOTAL - END["overlap"]
    END_CARD_START = END_START + END["fade"]
    TOTAL = END_CARD_START + END["rise"] + END["hold"]
else:
    END_START = END_CARD_START = RAW_TOTAL
    TOTAL = RAW_TOTAL + CFG["tail"]
MARKS["@endcard"] = END_CARD_START


def at(spec):
    """A mark name, [mark, frames] or absolute frame number to a frame index."""
    if isinstance(spec, (int, float)):
        return int(spec)
    mark, offset = (spec, 0) if isinstance(spec, str) else (spec[0], spec[1] if len(spec) > 1 else 0)
    if mark not in MARKS:
        sys.exit(f"unknown mark {mark!r}. Known: {', '.join(sorted(MARKS))}")
    return MARKS[mark] + offset


def clamp_cam(cx, cy, z):
    z = max(1.0, z)
    w, h = VW / z, VH / z
    return min(max(cx, w / 2), VW - w / 2), min(max(cy, h / 2), VH - h / 2), z


def resolve_move(move):
    """One camera entry to (start frame, duration, (cx, cy, zoom)) in viewport CSS pixels."""
    start = at(move["at"]) if "at" in move else 0
    dur = int(move.get("frames", 30))
    if move.get("focus") == "full" or (not move.get("focus") and not move.get("fit") and move.get("zoom", 1) == 1):
        return start, dur, (VW / 2, VH / 2, 1.0)
    focus = move.get("focus")
    zoom = move.get("zoom")
    if move.get("fit"):
        r = RECTS.get(move["fit"])
        if not r:
            sys.exit(f"camera fit: no rect named {move['fit']!r}. Recorded: {', '.join(RECTS) or 'none'}")
        pad = move.get("pad", 1.25)
        zoom = max(1.0, min(VW / (r["width"] * pad), VH / (r["height"] * pad)))
        cx, cy = r["x"] + r["width"] / 2, r["y"] + r["height"] / 2
    elif focus == "cursor":
        px, py, _ = TRACK["frames"][min(max(start, 0), RAW_TOTAL - 1)]
        cx, cy = px, py
    elif isinstance(focus, str):
        r = RECTS.get(focus)
        if not r:
            sys.exit(f"camera focus: no rect named {focus!r}. Recorded: {', '.join(RECTS) or 'none'}")
        cx, cy = r["x"] + r["width"] / 2, r["y"] + r["height"] / 2
    else:
        cx, cy = focus
    cx += move.get("dx", 0)
    cy += move.get("dy", 0)
    if zoom is None:
        sys.exit(f"camera entry at {move.get('at')!r} needs zoom, or fit")
    return start, dur, (cx, cy, zoom)


def smooth(t):
    # Quick start, long landing, with a short ramp so moves never begin on a jolt.
    t = max(0.0, min(1.0, t))
    ramp = t * t * (3 - 2 * t)
    return 0.35 * ramp + 0.65 * (1 - (1 - t) ** 3)


def ease(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3.4 if t > 0 else 0.0


def build_camera():
    moves = [resolve_move(m) for m in CFG["camera"]]
    if not moves or moves[0][0] > 0:
        moves.insert(0, (0, 0, (VW / 2, VH / 2, 1.0)))
    moves.sort(key=lambda m: m[0])
    state = moves[0][2]
    origin = state
    states = []
    index = -1
    reached = True
    for frame in range(RAW_TOTAL):
        while index + 1 < len(moves) and moves[index + 1][0] <= frame:
            index += 1
            origin = state
            reached = False
        start, dur, target = moves[index]
        if frame < start + dur:
            p = smooth((frame - start) / dur)
            lz = math.log(origin[2]) + (math.log(target[2]) - math.log(origin[2])) * p
            state = (origin[0] + (target[0] - origin[0]) * p, origin[1] + (target[1] - origin[1]) * p, math.exp(lz))
        else:
            if not reached:
                state = target
                reached = True
            # A slow push while holding, so no held shot goes dead. The next move starts from here.
            state = (state[0], state[1], state[2] * (1 + DRIFT / FPS) if state[2] > 1.02 else state[2])
        states.append(clamp_cam(*state))
    return states


CAM = build_camera()
SPANS = [(at(c["from"]), at(c["to"])) for c in CAPS]
_cache = {}


def assets():
    if not _cache:
        a = P["assets"]
        meta = json.load(open(f"{a}/captions-meta.json"))
        _cache["cursor"] = Image.open(f"{a}/cursor.png").convert("RGBA")
        _cache["caps"] = []
        for i, m in enumerate(meta):
            pill = Image.open(f"{a}/cap{i}-pill.png").convert("RGBA")
            words = [(Image.open(f"{a}/cap{i}-w{j}.png").convert("RGBA"), w) for j, w in enumerate(m["words"])]
            _cache["caps"].append((pill, words))
        _cache["end"] = Image.open(f"{a}/end.png").convert("RGB") if END else None
    return _cache["cursor"], _cache["caps"], _cache["end"]


def press_at(frame):
    amount = 0.0
    for k in range(4):
        i = frame - k
        if 0 <= i < RAW_TOTAL and TRACK["frames"][i][2]:
            amount = max(amount, 1 - k / 4)
    return amount


def with_opacity(image, alpha):
    if alpha >= 0.999:
        return image
    out = image.copy()
    out.putalpha(out.getchannel("A").point(lambda v: int(v * alpha)))
    return out


def draw_caption(canvas, frame):
    _, caps, _ = assets()
    for i, (start, end) in enumerate(SPANS):
        if not (start <= frame < end + 10):
            continue
        pill, words = caps[i]
        place = CAPS[i].get("y", 0.905)
        cx, cy = W // 2, int(H * place)
        enter = ease((frame - start) / 16)
        leave = max(0.0, (frame - end) / 10)
        lift = ((1 - enter) * 26 * K + leave * leave * 16 * K) * (-1 if place < 0.3 else 1)
        x = cx - pill.width // 2
        y = int(round(cy - pill.height / 2 + lift))
        alpha = min(1.0, (frame - start + 1) / 7) * (1 - leave)
        canvas.alpha_composite(with_opacity(pill, alpha), (x, max(0, y)))
        for j, (word, pos) in enumerate(words):
            t = (frame - start - 5 - j * 3) / 13
            if t <= 0:
                continue
            rise = (1 - ease(t)) * 15 * K
            canvas.alpha_composite(
                with_opacity(word, min(1.0, t * 2.4) * (1 - leave)),
                (x + int(pos["x"]), int(round(y + pos["y"] + rise))),
            )


def draw_cursor(canvas, frame, cam):
    cursor, _, _ = assets()
    cx, cy, z = cam
    px, py, _ = TRACK["frames"][frame]
    vw, vh = VW / z, VH / z
    sx = (px - (cx - vw / 2)) * W / vw
    sy = (py - (cy - vh / 2)) * H / vh
    if sx < -80 or sy < -80 or sx > W + 80 or sy > H + 80:
        return
    press = press_at(frame)
    size = CFG["style"]["cursor"]["size"]
    width = int(round(size * K * (z ** 0.3) * (1 - 0.16 * press)))
    height = int(round(width * cursor.height / cursor.width))
    art = cursor.resize((width, height), Image.LANCZOS)
    tip_x = 6 / 32 * width
    tip_y = 5.5 / 42 * height
    canvas.alpha_composite(art, (max(0, int(round(sx - tip_x))), max(0, int(round(sy - tip_y + 1.5 * press * K)))))


def render(frame):
    _, _, end_card = assets()
    if END and frame >= END_CARD_START:
        rise = ease((frame - END_CARD_START) / END["rise"])
        scale = 1.16 - 0.16 * rise
        w, h = W / scale, H / scale
        box = (max(0, W / 2 - w / 2), max(0, H / 2 - h / 2), min(W, W / 2 + w / 2), min(H, H / 2 + h / 2))
        plain = Image.new("RGB", (W, H), END["background"])
        card = end_card.resize((W, H), Image.LANCZOS, box=box) if end_card.size == (W, H) else end_card.resize((W, H), Image.LANCZOS)
        return Image.blend(plain, card, min(1.0, rise * 1.4)).tobytes()
    raw = min(frame, RAW_TOTAL - 1)
    cam = CAM[raw]
    cx, cy, z = cam
    vw, vh = VW / z, VH / z
    box = (max(0, cx - vw / 2) * DPR, max(0, cy - vh / 2) * DPR, min(VW, cx + vw / 2) * DPR, min(VH, cy + vh / 2) * DPR)
    source = Image.open(f"{P['take']}/frames/{raw:06d}.jpg").convert("RGB")
    view = source.resize((W, H), Image.LANCZOS, box=box).convert("RGBA")
    draw_cursor(view, raw, cam)
    draw_caption(view, frame)
    if END and frame >= END_START:
        view = Image.blend(view.convert("RGB"), Image.new("RGB", (W, H), END["background"]), (frame - END_START + 1) / END["fade"])
    return view.convert("RGB").tobytes()


def warn_soft_zoom():
    limit = DPR * VW / W
    peak = max(z for _, _, z in CAM)
    if peak > limit * 1.02:
        print(f"warning: camera zoom reaches {peak:.2f} but capture density only stays sharp to {limit:.2f}. Raise app.dpr to {math.ceil(peak * W / VW)}.", file=sys.stderr)


def warn_caption_overlaps():
    for i, (a0, a1) in enumerate(SPANS):
        for j in range(i + 1, len(SPANS)):
            b0, b1 = SPANS[j]
            if a0 < b1 + 10 and b0 < a1 + 10 and abs(CAPS[i].get("y", 0.905) - CAPS[j].get("y", 0.905)) < 0.08:
                print(f"warning: captions {i} and {j} overlap in time at the same height. Move one with \"y\" or shorten a span.", file=sys.stderr)


def main():
    timeline = {"fps": FPS, "rawFrames": RAW_TOTAL, "totalFrames": TOTAL, "seconds": TOTAL / FPS, "endStart": END_START, "endCardStart": END_CARD_START, "hasEnd": bool(END)}
    json.dump(timeline, open(P["timeline"], "w"))
    print(f"frames {TOTAL}, seconds {TOTAL / FPS:.2f}", flush=True)
    if "--plan" in args:
        return
    if not os.path.exists(f"{P['take']}/frames/000000.jpg"):
        sys.exit(f"no frames in {P['take']}/frames. Run the capture stage without --dry first.")
    warn_caption_overlaps()
    warn_soft_zoom()
    only = flag("--only")
    if only:
        folder = os.path.join(P["out"], "preview")
        os.makedirs(folder, exist_ok=True)
        for frame in map(int, only.split(",")):
            Image.frombytes("RGB", (W, H), render(frame)).save(f"{folder}/{frame:06d}.jpg", quality=92)
        print("wrote", folder)
        return
    audio = flag("--audio")
    command = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-"]
    if audio:
        command += ["-i", audio, "-c:a", "aac", "-b:a", "192k", "-shortest"]
    command += [
        "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
        "-c:v", "libx264", "-preset", CFG["output"]["preset"], "-crf", str(CFG["output"]["crf"]),
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
        "-movflags", "+faststart", P["video"],
    ]
    encoder = subprocess.Popen(command, stdin=subprocess.PIPE)
    with Pool(int(os.environ.get("WORKERS", os.cpu_count() or 4))) as pool:
        for i, data in enumerate(pool.imap(render, range(TOTAL), chunksize=6)):
            encoder.stdin.write(data)
            if i % 300 == 0:
                print(i, flush=True)
    encoder.stdin.close()
    if encoder.wait() != 0:
        sys.exit("ffmpeg failed")
    print("wrote", P["video"])


if __name__ == "__main__":
    main()
