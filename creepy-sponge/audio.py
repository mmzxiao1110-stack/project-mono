"""Soundtrack for the Porus test episode: cheerful start, tape-stop decay, horror.

Writes build/soundtrack.wav and build/mouth.npy (mouth openness per 1/12 s,
derived from the voice track so the character's mouth syncs to the lines).
Voice: espeak-ng formant synth, mangled (slowed, ring-modulated, reverbed) so it
sounds intentionally inhuman. No samples, no AI voice.
"""
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 44100
DUR = 60.0
FPS = 12
OUT = Path(__file__).resolve().parent / "build"
OUT.mkdir(exist_ok=True)
rng = np.random.default_rng(11)
N = int(DUR * SR)
tt = np.arange(N) / SR


def fft_filter(x, lo=None, hi=None, order=2):
    f = np.fft.rfftfreq(len(x), 1 / SR)
    g = np.ones_like(f)
    if hi:
        g *= 1 / np.sqrt(1 + (f / hi) ** (2 * order))
    if lo:
        g *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** (2 * order))
    return np.fft.irfft(np.fft.rfft(x) * g, len(x))


def convolve(x, ir):
    n = len(x) + len(ir) - 1
    M = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, M) * np.fft.rfft(ir, M), M)[: len(x)]


def reverb_ir(sec, decay, hi=6000):
    t = np.arange(int(sec * SR)) / SR
    ir = fft_filter(rng.normal(size=len(t)), hi=hi) * np.exp(-t * decay)
    return ir / np.sqrt((ir ** 2).sum())


def place(buf, sig, t0, gain=1.0):
    i = int(t0 * SR)
    j = min(len(buf), i + len(sig))
    if 0 <= i < len(buf):
        buf[i:j] += sig[: j - i] * gain


def midi(n):
    return 440 * 2 ** ((n - 69) / 12)


def pluck(f, dur, vel=0.4, bright=1.0):
    t = np.arange(int(dur * SR)) / SR
    x = sum(np.sin(2 * np.pi * f * k * t) * np.exp(-t * (3 + 4 * k / bright)) / k for k in range(1, 7))
    return x * np.minimum(1, t / 0.003) * vel


def glock(f, dur=0.8, vel=0.25):
    t = np.arange(int(dur * SR)) / SR
    return (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 8)) * np.exp(-t * 4) * vel


def espeak(text, voice, pitch, speed):
    with tempfile.NamedTemporaryFile(suffix=".wav") as f:
        subprocess.run(["espeak-ng", "-v", voice, "-p", str(pitch), "-s", str(speed), "-w", f.name, text], check=True)
        with wave.open(f.name) as w:
            sr = w.getframerate()
            x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    # resample to SR
    return np.interp(np.arange(int(len(x) * SR / sr)) * sr / SR, np.arange(len(x)), x)


def resample(x, rate):
    """rate < 1: slower and lower (tape-style)."""
    idx = np.arange(0, len(x) - 1, rate)
    return np.interp(idx, np.arange(len(x)), x)


# ------------------------------------------------------------ 0-32 s: happy tune
happy = np.zeros(N)
beat = 0.5
prog = [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67], [57, 60, 64], [65, 69, 72], [67, 71, 74], [60, 64, 67]]
mel_scale = [72, 74, 76, 79, 81, 84]
for bar in range(16):  # 32 s of material, the second half gets tape-stopped
    chord = prog[bar % 8]
    t0 = bar * 4 * beat
    for b in range(4):
        for k, n in enumerate(chord):  # ukulele-ish strum
            place(happy, pluck(midi(n), 0.6, 0.18), t0 + b * beat + k * 0.012)
        if b % 2 == 0:
            place(happy, pluck(midi(chord[0] - 24), 0.9, 0.35, bright=0.4), t0 + b * beat)
    for s in range(8):
        if rng.random() < 0.6:
            place(happy, glock(midi(rng.choice(mel_scale))), t0 + s * beat / 2 * 2 + (0.25 if s % 2 else 0))
for k in range(40):  # bubble blips
    t0 = rng.random() * 30
    d = np.arange(int(0.08 * SR)) / SR
    f0 = 600 + 900 * rng.random()
    place(happy, np.sin(2 * np.pi * (f0 * d + 4000 * d ** 2)) * np.exp(-d * 40) * 0.08, t0)

# tape-stop: from 16 s the playback rate sinks from 1.0 to 0.5, plus wobble
rate = np.ones(N)
m = tt > 16
rate[m] = np.clip(1 - (tt[m] - 16) / 14 * 0.5, 0.5, 1) + 0.03 * np.sin(2 * np.pi * 0.7 * tt[m]) * (tt[m] - 16) / 14
pos = np.cumsum(rate) - 1
music = np.interp(np.minimum(pos, N - 1), np.arange(N), happy)
fade = np.clip((31.5 - tt) / 6, 0, 1)
music *= fade
music = music + 0.3 * convolve(music, reverb_ir(1.2, 4))

# ------------------------------------------------------------ drones & horror
horror = np.zeros(N)
saw = lambda f: 2 * ((tt * f) % 1) - 1
drone = fft_filter(saw(41.2) + saw(43.65) + 0.6 * saw(61.7), hi=220)
horror += drone * np.clip((tt - 18) / 14, 0, 1) * 0.22
cluster = sum(np.sin(2 * np.pi * f * tt + 3 * np.sin(2 * np.pi * 0.2 * tt + f)) for f in (1480, 1568, 1661, 2217))
horror += cluster * np.clip((tt - 30) / 8, 0, 1) * (tt < 54) * 0.012
# heartbeat accelerating from 32 s
hb_t, period = 32.5, 1.0
while hb_t < 54:
    for off, g in ((0, 1.0), (0.22, 0.7)):
        d = np.arange(int(0.25 * SR)) / SR
        place(horror, np.sin(2 * np.pi * (55 * d - 40 * d ** 2)) * np.exp(-d * 18) * 0.5 * g, hb_t + off)
    hb_t += period
    period = max(0.45, period * 0.95)


def boom(len_s=2.5):
    d = np.arange(int(len_s * SR)) / SR
    low = np.sin(2 * np.pi * np.cumsum(30 + 70 * np.exp(-d * 6)) / SR) * np.exp(-d * 1.8)
    hit = fft_filter(rng.normal(size=len(d)), lo=300, hi=5000) * np.exp(-d * 9)
    screech = fft_filter(rng.normal(size=len(d)), lo=2500, hi=4500) * np.exp(-d * 3) * 0.5
    return np.tanh(1.5 * (low + 0.5 * hit + screech)) * 0.8


def riser(len_s=1.2):
    d = np.arange(int(len_s * SR)) / SR
    return fft_filter(rng.normal(size=len(d)), lo=1500, hi=9000) * (d / len_s) ** 3 * 0.35


for t_cut in (32.0, 36.0, 40.0, 44.0, 49.0):
    place(horror, riser(), t_cut - 1.2)
    place(horror, boom(), t_cut)
# metallic scrape while the door creaks (28-32)
d = np.arange(int(4 * SR)) / SR
creak = np.sin(2 * np.pi * np.cumsum(180 + 60 * np.sin(2 * np.pi * 1.3 * d) + 40 * rng.normal(size=len(d)).cumsum() / SR * 0) / SR)
creak = fft_filter(np.sign(creak) * np.abs(creak) ** 0.3, lo=300, hi=3000) * np.clip(np.sin(np.pi * d / 4), 0, 1) * 0.08
place(horror, creak, 28)
# 54-56 glitch bursts
for k in range(14):
    t0 = 54 + rng.random() * 2
    burst = rng.normal(size=int(rng.uniform(0.03, 0.15) * SR)) * 0.4
    place(horror, fft_filter(burst, lo=200, hi=rng.uniform(2000, 8000)), t0)
# 56-60 tinnitus + final hit
horror += np.sin(2 * np.pi * 7200 * tt) * ((tt > 56) & (tt < 59.2)) * 0.01
place(horror, boom(1.0), 59.2, 1.2)
horror *= (tt < 59.8)

# ------------------------------------------------------------ voice
voice = np.zeros(N)
creepy_rv = reverb_ir(2.5, 2.2, hi=4000)


def creepy_line(text, t0, slow=0.72, gain=1.0):
    base = espeak(text, "en+m3", 25, 115)
    low = resample(base, slow)
    ring = low * np.sin(2 * np.pi * 34 * np.arange(len(low)) / SR)
    whisper = resample(espeak(text, "en+whisper", 60, 115), slow * 1.0)
    L = max(len(low), len(whisper))
    v = np.zeros(L)
    v[: len(low)] += 0.75 * low + 0.45 * ring
    v[: len(whisper)] += 0.35 * whisper
    v = fft_filter(v, lo=90, hi=5000)
    wet = convolve(np.concatenate([v, np.zeros(int(2.5 * SR))]), creepy_rv)
    swell_len = int(1.0 * SR)
    # reverse-reverb swell: reverb of the reversed line, reversed back, so it rises into the words
    pre = convolve(np.concatenate([v[::-1], np.zeros(swell_len)]), creepy_rv)[::-1]
    seg = np.zeros(swell_len + len(wet))
    seg[: len(pre)] += pre * 0.35
    seg[swell_len: swell_len + len(v)] += v
    seg[swell_len: swell_len + len(wet)] += wet * 0.6
    place(voice, seg / (np.abs(seg).max() + 1e-9) * 0.8 * gain, t0 - swell_len / SR)
    return t0, t0 + len(v) / SR


happy_line = resample(espeak("Hi friend! Do you want to play with me?", "en+f3", 85, 170), 1.12)
happy_line = fft_filter(happy_line, lo=150, hi=7000)
place(voice, happy_line / np.abs(happy_line).max() * 0.7, 9.0)
speech_spans = [(9.0, 9.0 + len(happy_line) / SR)]
speech_spans.append(creepy_line("do you want to come inside", 24.3))
speech_spans.append(creepy_line("I can hear you breathing", 44.6))
stay = resample(espeak("stay", "en+whisper", 30, 80), 0.6)
stay = fft_filter(stay, lo=200, hi=6000)
stay_w = convolve(np.concatenate([stay, np.zeros(2 * SR)]), creepy_rv)
place(voice, stay_w / np.abs(stay_w).max() * 0.6, 57.3)

# ------------------------------------------------------------ mix
mix = music * 0.8 + horror + voice * 1.1
mix = fft_filter(mix, lo=25)
mix = np.tanh(mix / (np.abs(mix).max() + 1e-9) * 1.4) * 0.88
with wave.open(str(OUT / "soundtrack.wav"), "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype(np.int16).tobytes())

# mouth openness per render frame, only while Porus is speaking
env = np.sqrt(np.convolve(voice ** 2, np.ones(SR // 30) / (SR // 30), mode="same"))
frames = int(DUR * FPS)
mouth = np.array([env[min(N - 1, int(f / FPS * SR))] for f in range(frames)])
mask = np.zeros(frames)
for a, b in speech_spans:
    mask[int(a * FPS): int(b * FPS) + 2] = 1
mouth = np.clip(mouth / (np.percentile(mouth[mask > 0], 95) + 1e-9), 0, 1) * mask
np.save(OUT / "mouth.npy", mouth)
print("spans", [(round(a, 2), round(b, 2)) for a, b in speech_spans])
print("wrote", OUT / "soundtrack.wav")
