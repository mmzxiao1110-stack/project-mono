"""Render a vertical "Can you reverse the spin with your mind?" illusion reel.

Each level is a glowing point cloud spinning about its vertical axis, drawn with
orthographic projection and no depth cues (no perspective, no depth shading, no
occlusion). That is what makes the spin direction ambiguous: the brain can read
the same frames as clockwise or counter-clockwise, and with focus you can flip it.

Usage: python3 render.py [out.mp4]
"""
import math
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1080, 1920, 30
SEG_SECONDS = 6.5
OUTRO_SECONDS = 3.5
HERE = Path(__file__).resolve().parent
FONT_DIR = Path("/usr/share/fonts/opentype/inter")
rng = np.random.default_rng(7)


def font(name, size):
    return ImageFont.truetype(str(FONT_DIR / name), size)


# ---------------------------------------------------------------- point clouds
def lerp_colors(t, stops):
    """t in [0,1] -> RGB via linear interpolation through colour stops."""
    stops = np.array(stops, dtype=np.float32)
    x = np.clip(t, 0, 1) * (len(stops) - 1)
    i = np.minimum(x.astype(int), len(stops) - 2)
    f = (x - i)[:, None]
    return stops[i] * (1 - f) + stops[i + 1] * f


def arrow_ring(n=26000):
    """Flat band bent into a ring that ends in an arrowhead (the classic one)."""
    R, half_h = 1.0, 0.16
    body_end = 1.72 * math.pi
    head_len = 0.42 * math.pi
    u = rng.random(n)
    in_head = u > 0.8
    theta = np.where(in_head, body_end + rng.random(n) * head_len, rng.random(n) * body_end)
    # height limit: constant on body, flares then tapers to a point on the head
    s = np.clip((theta - body_end) / head_len, 0, 1)
    limit = np.where(in_head, half_h * 2.1 * (1 - s), half_h)
    y = (rng.random(n) * 2 - 1) * limit
    r = R + rng.normal(0, 0.012, n)
    pts = np.stack([r * np.cos(theta), y, r * np.sin(theta)], 1)
    hy = (y / (half_h * 2.1) + 1) / 2  # 0 bottom .. 1 top
    col = lerp_colors(hy, [(40, 70, 255), (60, 90, 255), (235, 40, 60), (255, 170, 40), (255, 230, 120)])
    # red tint toward the tail end
    tail = np.clip(1 - theta / 0.5, 0, 1)[:, None]
    col = col * (1 - tail) + np.array([255, 40, 60]) * tail
    return pts * 0.95, col


def sphere(n=18000):
    v = rng.normal(size=(n, 3))
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    hue = rng.random(n)
    col = lerp_colors(hue, [(255, 70, 90), (255, 190, 60), (120, 255, 120), (60, 200, 255), (170, 90, 255), (255, 80, 200)]) * 1.8
    return v * 0.95, col


def cylinder(n=14000):
    theta = rng.random(n) * 2 * math.pi
    y = (rng.random(n) * 2 - 1) * 1.1
    pts = np.stack([0.6 * np.cos(theta), y, 0.6 * np.sin(theta)], 1)
    g = rng.random(n)
    col = lerp_colors(g, [(60, 220, 90), (150, 255, 120), (220, 255, 160)]) * 1.6
    return pts, col


def spring(n=26000):
    turns = 9
    t = rng.random(n)
    theta = t * turns * 2 * math.pi
    y = (t * 2 - 1) * 1.1
    jitter = rng.normal(0, 0.022, (n, 3))
    pts = np.stack([0.72 * np.cos(theta), y, 0.72 * np.sin(theta)], 1) + jitter
    col = np.tile(np.array([[235, 238, 255]], np.float32), (n, 1)) * (0.75 + 0.25 * rng.random((n, 1)))
    return pts, col


def wire_cube(n=22000):
    c = np.array([[x, y, z] for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)], float)
    edges = [(a, b) for a in range(8) for b in range(a + 1, 8) if np.abs(c[a] - c[b]).sum() == 2]
    # add a cross on two faces, like a door, so the shape reads as an object
    extra = [((0, -1, 1), (0, 1, 1)), ((-1, 0, 1), (1, 0, 1)), ((0, -1, -1), (0, 1, -1))]
    segs = [(c[a], c[b]) for a, b in edges] + [(np.array(a, float), np.array(b, float)) for a, b in extra]
    k = rng.integers(0, len(segs), n)
    t = rng.random((n, 1))
    A = np.array([s[0] for s in segs])[k]
    B = np.array([s[1] for s in segs])[k]
    pts = A * (1 - t) + B * t + rng.normal(0, 0.03, (n, 3))
    g = rng.random(n)
    col = lerp_colors(g, [(200, 140, 40), (255, 200, 80), (255, 235, 160)])
    return pts * 0.62, col


def gyro(n=30000):
    """Wire globe with an orbit ring - the 'extreme' level."""
    parts, cols = [], []
    m = n // 2
    # meridians
    k = rng.integers(0, 10, m)
    phi = k / 10 * math.pi
    a = rng.random(m) * 2 * math.pi
    p = np.stack([np.cos(a) * np.cos(phi), np.sin(a), np.cos(a) * np.sin(phi)], 1)
    parts.append(p)
    cols.append(lerp_colors(np.abs(np.sin(a)), [(80, 230, 255), (160, 120, 255), (255, 90, 200)]))
    # latitudes
    m2 = n // 4
    lat = (rng.integers(1, 8, m2) / 8 - 0.5) * math.pi
    a = rng.random(m2) * 2 * math.pi
    p = np.stack([np.cos(lat) * np.cos(a), np.sin(lat), np.cos(lat) * np.sin(a)], 1)
    parts.append(p)
    cols.append(np.tile([[90, 255, 220]], (m2, 1)).astype(np.float32))
    # tilted orbit ring
    m3 = n - m - m2
    a = rng.random(m3) * 2 * math.pi
    ring = np.stack([1.45 * np.cos(a), np.zeros(m3), 1.45 * np.sin(a)], 1)
    tilt = math.radians(28)
    rx = np.array([[1, 0, 0], [0, math.cos(tilt), -math.sin(tilt)], [0, math.sin(tilt), math.cos(tilt)]])
    parts.append(ring @ rx.T + rng.normal(0, 0.015, (m3, 3)))
    cols.append(np.tile([[255, 235, 90]], (m3, 1)).astype(np.float32))
    return np.concatenate(parts) * 0.66, np.concatenate(cols)


LEVELS = [
    # name, builder, scale(px per unit), elevation(deg), rev/sec, difficulty, colour
    ("LEVEL 1", arrow_ring, 400, 18, 0.22, "EASY", (90, 230, 120)),
    ("LEVEL 2", sphere, 410, 12, 0.18, "MEDIUM", (255, 210, 70)),
    ("LEVEL 3", cylinder, 400, 0, 0.20, "HARD", (255, 130, 60)),
    ("LEVEL 4", spring, 400, 8, 0.20, "INSANE", (255, 70, 200)),
    ("LEVEL 5", wire_cube, 420, 22, 0.17, "EXTREME", (255, 60, 60)),
    ("LEVEL 6", gyro, 400, 14, 0.16, "IMPOSSIBLE", (170, 110, 255)),
]


# ---------------------------------------------------------------- rendering
def project(pts, angle, elev_deg, scale, cx, cy):
    ca, sa = math.cos(angle), math.sin(angle)
    x = pts[:, 0] * ca + pts[:, 2] * sa
    z = -pts[:, 0] * sa + pts[:, 2] * ca
    y = pts[:, 1]
    e = math.radians(elev_deg)
    # orthographic tilt: deliberately throw away z afterwards (no depth cue)
    y2 = y * math.cos(e) - z * math.sin(e)
    return cx + x * scale, cy - y2 * scale


def splat(px, py, col, gain=0.55):
    buf = np.zeros((H, W, 3), np.float32)
    x0 = np.floor(px).astype(int)
    y0 = np.floor(py).astype(int)
    fx, fy = px - x0, py - y0
    for dx, dy, w in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
        xi, yi = x0 + dx, y0 + dy
        ok = (xi >= 0) & (xi < W) & (yi >= 0) & (yi < H)
        np.add.at(buf, (yi[ok], xi[ok]), col[ok] * (w[ok, None] * gain))
    return buf


def glow(buf):
    sharp = Image.fromarray(np.clip(buf * 1.4, 0, 255).astype(np.uint8))
    soft = sharp.filter(ImageFilter.GaussianBlur(1.1))
    small = sharp.resize((W // 4, H // 4), Image.BILINEAR).filter(ImageFilter.GaussianBlur(5))
    halo = Image.fromarray(np.clip(np.asarray(small, np.float32) * 5.0, 0, 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)
    out = ImageChops.add(ImageChops.add(sharp, soft), ImageChops.multiply(halo, Image.new("RGB", (W, H), (110, 110, 110))))
    return out


def centered(draw, y, text, fnt, fill, stroke=0, stroke_fill=(0, 0, 0)):
    w = draw.textlength(text, font=fnt)
    draw.text(((W - w) / 2, y), text, font=fnt, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)


def level_overlay(i):
    name, _, _, _, _, diff, dcol = LEVELS[i]
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    # level pill with progress dots
    pill_f = font("InterDisplay-Bold.otf", 40)
    dots = "  " + " ".join("●" if k <= i else "○" for k in range(len(LEVELS)))
    label = name + dots
    tw = d.textlength(label, font=pill_f)
    x0, y0 = (W - tw) / 2 - 34, 200
    d.rounded_rectangle((x0, y0, x0 + tw + 68, y0 + 70), radius=35, outline=(170, 120, 255), width=4, fill=(30, 18, 60, 200))
    d.text((x0 + 34, y0 + 10), label, font=pill_f, fill=(235, 225, 255))
    title = font("InterDisplay-Black.otf", 78)
    centered(d, 310, "Can you reverse the", title, (255, 255, 255))
    centered(d, 400, "spin with your mind?", title, (255, 255, 255))
    df = font("InterDisplay-Bold.otf", 56)
    pre = "Difficulty: "
    total = d.textlength(pre + diff, font=df)
    x = (W - total) / 2
    d.text((x, 515), pre, font=df, fill=(220, 220, 230))
    d.text((x + d.textlength(pre, font=df), 515), diff, font=df, fill=dcol)
    hint = font("Inter-Medium.otf", 40)
    centered(d, 1660, "Stare at the centre. Imagine it", hint, (190, 190, 205))
    centered(d, 1712, "turning the other way.", hint, (190, 190, 205))
    return ov


def outro_overlay():
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    big = font("InterDisplay-Black.otf", 96)
    centered(d, 640, "Your brain is", big, (255, 255, 255))
    centered(d, 750, "more powerful", big, (120, 255, 120))
    centered(d, 860, "than you think.", big, (90, 200, 255))
    mid = font("InterDisplay-Bold.otf", 58)
    centered(d, 1100, "Which level did you", mid, (230, 230, 240))
    centered(d, 1172, "get stuck on?", mid, (230, 230, 240))
    centered(d, 1290, "Comment below", font("InterDisplay-Bold.otf", 50), (255, 210, 70))
    return ov


def fade(t, dur, edge=0.35):
    return min(1.0, t / edge, (dur - t) / edge) if dur > 0 else 1.0


def progress_bar(img, frac, col):
    d = ImageDraw.Draw(img)
    y = 1820
    d.rounded_rectangle((140, y, W - 140, y + 10), radius=5, fill=(45, 45, 55))
    d.rounded_rectangle((140, y, 140 + (W - 280) * frac, y + 10), radius=5, fill=col)


def write_audio(path, seconds, sr=44100):
    """Soft ambient pad + slow pulse so the reel isn't silent."""
    t = np.arange(int(seconds * sr)) / sr
    chord = [110.0, 164.81, 220.0, 261.63, 329.63]  # A minor-ish pad
    pad = sum(np.sin(2 * math.pi * f * t + k) * (0.5 + 0.5 * np.sin(2 * math.pi * 0.07 * (k + 1) * t)) for k, f in enumerate(chord))
    pad += 0.35 * np.sin(2 * math.pi * 55 * t)
    pulse_t = (t * (1 / SEG_SECONDS) * 4) % 1  # 4 soft pulses per level
    pulse = np.sin(2 * math.pi * 440 * t) * np.exp(-pulse_t * 18) * 0.25
    sig = pad / len(chord) * 0.5 + pulse
    env = np.minimum(1, np.minimum(t / 1.5, (seconds - t) / 2.0))
    sig = (sig * env * 0.6 * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(sig.tobytes())


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "reverse_the_spin.mp4"
    total = SEG_SECONDS * len(LEVELS) + OUTRO_SECONDS
    audio = HERE / "pad.wav"
    write_audio(audio, total)
    ff = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-i", str(audio), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(out)],
        stdin=subprocess.PIPE,
    )
    cx, cy = W / 2, 1110
    for i, (name, build, scale, elev, rps, diff, dcol) in enumerate(LEVELS):
        pts, col = build()
        ov = level_overlay(i)
        n = int(SEG_SECONDS * FPS)
        print(f"{name}: {len(pts)} points, {n} frames", flush=True)
        for f in range(n):
            t = f / FPS
            px, py = project(pts, 2 * math.pi * rps * t, elev, scale, cx, cy)
            frame = glow(splat(px, py, col))
            a = fade(t, SEG_SECONDS)
            frame = Image.blend(Image.new("RGB", (W, H)), frame, a).convert("RGBA")
            frame.alpha_composite(ov)
            frame = frame.convert("RGB")
            progress_bar(frame, (f + 1) / n, dcol)
            ff.stdin.write(frame.tobytes())
    # outro: last object keeps spinning faintly behind the text
    pts, col = LEVELS[0][1]()
    ov = outro_overlay()
    n = int(OUTRO_SECONDS * FPS)
    for f in range(n):
        t = f / FPS
        px, py = project(pts, 2 * math.pi * 0.2 * t, 18, 300, cx, 1500)
        frame = glow(splat(px, py, col * 0.45))
        a = fade(t, OUTRO_SECONDS)
        frame = Image.blend(Image.new("RGB", (W, H)), frame, a).convert("RGBA")
        ov_f = ov.copy()
        ov_f.putalpha(ov.getchannel("A").point(lambda v: int(v * a)))
        frame.alpha_composite(ov_f)
        ff.stdin.write(frame.convert("RGB").tobytes())
    ff.stdin.close()
    ff.wait()
    audio.unlink(missing_ok=True)
    print("wrote", out)


if __name__ == "__main__":
    main()
