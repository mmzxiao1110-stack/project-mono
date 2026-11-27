"""Grade the rendered frames, add titles and glitches, encode with the soundtrack.

Frames are rendered at 12 fps and held for 2 output frames (deliberately cheap,
choppy look). Output: build/porus_episode1.mp4, 1920x1080, 24 fps.
"""
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
B = HERE / "build"
W, H, FPS, SRC_FPS, DUR = 1920, 1080, 24, 12, 60.0
FONT = "/usr/share/fonts/opentype/inter/InterDisplay-Black.otf"
FONT_M = "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"
rng = np.random.default_rng(3)

yy, xx = np.mgrid[0:H, 0:W]
r2 = ((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2
VIGNETTE = np.clip(1 - 0.55 * r2, 0, 1)[..., None].astype(np.float32)
SCAN = (1 - 0.12 * (yy % 4 < 2))[..., None].astype(np.float32)
CUTS = (32.0, 36.0, 40.0, 44.0, 49.0)


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def text_layer(lines):
    """lines: [(text, font_path, size, y, rgb)] -> RGBA overlay."""
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for text, fp, size, y, col in lines:
        f = ImageFont.truetype(fp, size)
        w = d.textlength(text, font=f)
        d.text(((W - w) / 2, y), text, font=f, fill=col, stroke_width=max(2, size // 14), stroke_fill=(20, 30, 60))
    return np.asarray(im, np.float32) / 255


TITLE = text_layer([
    ("PORUS", FONT, 220, 300, (255, 214, 90)),
    ("and the Sunny Reef", FONT, 84, 560, (120, 230, 255)),
    ("Episode 1  ·  A New Friend", FONT_M, 46, 700, (255, 255, 255)),
])
END = text_layer([("PORUS WILL VISIT YOU TONIGHT", FONT, 96, 480, (200, 20, 20))])


def over(img, layer, alpha=1.0):
    a = layer[..., 3:4] * alpha
    return img * (1 - a) + layer[..., :3] * a


def load(i):
    p = B / "frames" / f"f{i:04d}.png"
    return np.asarray(Image.open(p).convert("RGB"), np.float32) / 255


def grade(img, t):
    mood = float(smooth((t - 16) / 16)) * 0.6 + (0.4 if t >= 32 else 0.0)
    lum = img.mean(axis=2, keepdims=True)
    sat = 1.15 - 0.75 * mood
    img = lum + (img - lum) * sat
    if mood < 0.3:  # warm, bright cartoon
        img = img * np.array([1.04, 1.01, 0.95])
    img = (img - 0.5) * (1 + 0.35 * mood) + 0.5
    img = img * (1 - mood + mood * VIGNETTE)
    if t >= 32:
        # chromatic split + red push + scanlines
        shift = 3 + int(4 * abs(np.sin(t * 3)))
        img[..., 0] = np.roll(img[..., 0], shift, axis=1)
        img[..., 2] = np.roll(img[..., 2], -shift, axis=1)
        img = img * np.array([1.12, 0.92, 0.9]) * SCAN
    grain = rng.normal(0, 0.012 + 0.05 * mood, (H // 2, W // 2, 1)).astype(np.float32)
    img = img + np.repeat(np.repeat(grain, 2, 0), 2, 1)
    return img


def glitch(img):
    out = img.copy()
    for _ in range(rng.integers(4, 12)):
        y0 = rng.integers(0, H - 20)
        h = rng.integers(8, 120)
        out[y0:y0 + h] = np.roll(out[y0:y0 + h], rng.integers(-300, 300), axis=1)
    if rng.random() < 0.3:
        out = out[..., ::-1]
    if rng.random() < 0.2:
        out = 1 - out
    return out


def main():
    ff = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-i", str(B / "soundtrack.wav"), "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(B / "porus_episode1.mp4")],
        stdin=subprocess.PIPE,
    )
    black = np.zeros((H, W, 3), np.float32)
    for f in range(int(DUR * FPS)):
        t = f / FPS
        if t < 56:
            src = min(int(t * SRC_FPS), 671)
            img = grade(load(src), t)
            if t < 3.8:
                a = float(np.clip(min(t / 0.3, (3.8 - t) / 0.5), 0, 1))
                img = over(img * (1 - 0.35 * a), TITLE, a)
            for c in CUTS:  # 2-frame flash on each scare cut
                if 0 <= t - c < 2 / FPS:
                    img = np.clip(img * 0.3 + np.array([1.0, 0.15, 0.1]) * 0.8, 0, 1)
            if t >= 44 and rng.random() < 0.05:  # dropped frames
                img = img * 0.1
            if t >= 54:
                img = glitch(img)
                if rng.random() < 0.25:  # subliminal flash of the mouth
                    img = glitch(grade(load(rng.integers(600, 640)), 50))
        else:
            img = black.copy()
            if 56.6 <= t < 59.2:
                a = float(np.clip((t - 56.6) / 0.4, 0, 1))
                img = over(img, END, a)
                if rng.random() < 0.15:
                    img = np.roll(img, rng.integers(-12, 12), axis=1)
            if 59.2 <= t < 59.2 + 3 / FPS:
                img = grade(load(612), 51)
            img = img + rng.normal(0, 0.03, (H, W, 1))
        ff.stdin.write((np.clip(img, 0, 1) * 255).astype(np.uint8).tobytes())
    ff.stdin.close()
    ff.wait()
    print("wrote", B / "porus_episode1.mp4")


if __name__ == "__main__":
    main()
