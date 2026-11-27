"""Procedural lo-fi hip hop beat, synthesized from scratch with numpy.

Every sound (electric piano, bass, drums, vinyl crackle, tape wobble, reverb)
is generated in code. No samples, no AI models.

Usage: python3 lofi.py [seed] [out.wav]
"""
import sys
import wave
from pathlib import Path

import numpy as np

SR = 44100
BPM = 76
BEAT = 60 / BPM
BAR = 4 * BEAT
SWING = 0.58  # 0.5 = straight 8ths

seed = int(sys.argv[1]) if len(sys.argv) > 1 else 3
rng = np.random.default_rng(seed)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def t_of(bar, beat8):
    """Time of an 8th-note step inside a bar, with swing on off-beats."""
    beat, off = divmod(beat8, 2)
    return bar * BAR + (beat + (SWING if off else 0)) * BEAT


# --------------------------------------------------------------- filters (FFT)
def fft_filter(x, lo=None, hi=None, order=2):
    n = len(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    X = np.fft.rfft(x)
    g = np.ones_like(f)
    if hi:
        g *= 1 / np.sqrt(1 + (f / hi) ** (2 * order))
    if lo:
        g *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** (2 * order))
    return np.fft.irfft(X * g, n)


def convolve(x, ir):
    n = len(x) + len(ir) - 1
    N = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N), N)[: len(x)]


# --------------------------------------------------------------- instruments
def epiano(freq, dur, vel=0.5):
    """FM electric piano: bell-like attack that mellows out."""
    t = np.arange(int((dur + 1.2) * SR)) / SR
    index = 1.8 * np.exp(-t * 5) + 0.25
    car = np.sin(2 * np.pi * freq * t + index * np.sin(2 * np.pi * freq * t))
    tine = 0.15 * np.sin(2 * np.pi * freq * 4.0 * t) * np.exp(-t * 14)
    env = np.minimum(1, t / 0.004) * np.exp(-t * 0.9)
    release = np.clip(1 - (t - dur) / 0.6, 0, 1)
    trem = 1 + 0.12 * np.sin(2 * np.pi * 4.2 * t)
    return (car + tine) * env * release * trem * vel


def bass(freq, dur, vel=0.6):
    t = np.arange(int((dur + 0.15) * SR)) / SR
    x = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(4 * np.pi * freq * t)
    env = np.minimum(1, t / 0.01) * np.exp(-t * 1.6) * np.clip(1 - (t - dur) / 0.1, 0, 1)
    return np.tanh(1.6 * x * env) * vel


def pluck(freq, dur, vel=0.35):
    """Soft mallet / kalimba-ish lead."""
    t = np.arange(int((dur + 0.8) * SR)) / SR
    x = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * freq * 3.01 * t) * np.exp(-t * 9)
    env = np.minimum(1, t / 0.006) * np.exp(-t * 2.8)
    return x * env * vel


def kick():
    t = np.arange(int(0.45 * SR)) / SR
    f = 48 + 80 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.tanh(2.2 * np.sin(ph) * np.exp(-t * 7.5)) * 0.95


def snare():
    t = np.arange(int(0.35 * SR)) / SR
    noise = fft_filter(rng.normal(size=len(t)), lo=900, hi=6000) * np.exp(-t * 16)
    body = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 25)
    return (noise * 0.55 + body * 0.5) * 0.7


def hat(open_=False):
    t = np.arange(int((0.25 if open_ else 0.06) * SR)) / SR
    x = fft_filter(rng.normal(size=len(t)), lo=7000, hi=12000)
    return x * np.exp(-t * (14 if open_ else 70)) * 0.22


# --------------------------------------------------------------- song
CHORDS = [  # Fmaj9, Em7, Dm9, Cmaj9 (voicings as MIDI notes)
    [53, 57, 60, 64, 67],
    [52, 55, 59, 62, 66 - 1],
    [50, 57, 60, 64, 65],
    [48, 55, 59, 62, 64],
]
ROOTS = [41, 40, 38, 36]
PENTA = [60, 62, 64, 67, 69, 72, 74, 76]

# sections: (bars, drums, bass, melody, chord filter cutoff)
SECTIONS = [(4, False, False, False, 1400), (8, True, True, False, 4000), (8, True, True, True, 4000), (4, False, True, True, 1800)]
total_bars = sum(s[0] for s in SECTIONS)
length = int((total_bars * BAR + 3) * SR)

keys = np.zeros(length)
bass_t = np.zeros(length)
lead = np.zeros(length)
drums = np.zeros(length)
kick_env = np.zeros(length)


def add(buf, sig, t):
    i = int(t * SR)
    j = min(length, i + len(sig))
    if i < length:
        buf[i:j] += sig[: j - i]


K, S = kick(), snare()
bar = 0
keys_cut = np.zeros(length)
for nbars, has_drums, has_bass, has_lead, cut in SECTIONS:
    for b in range(nbars):
        ci = bar % 4
        chord, root = CHORDS[ci], ROOTS[ci]
        # keys: hit on 1 and a soft re-hit on the "and" of 3, strummed
        for hit_t, vel, dur in ((t_of(bar, 0), 0.42, BAR * 0.62), (t_of(bar, 5), 0.24, BAR * 0.3)):
            for k, n in enumerate(chord):
                add(keys, epiano(midi(n), dur, vel * (0.85 + 0.3 * rng.random())), hit_t + k * 0.018 + rng.normal(0, 0.004))
        keys_cut[int(bar * BAR * SR): int((bar + 1) * BAR * SR)] = cut
        if has_bass:
            for step, dur, n in ((0, BEAT * 1.4, root), (3, BEAT * 0.4, root), (5, BEAT * 1.2, root + (7 if b % 2 else 12))):
                add(bass_t, bass(midi(n), dur), t_of(bar, step))
        if has_drums:
            for step in (0, 5) if b % 2 == 0 else (0, 3, 5):
                add(drums, K, t_of(bar, step))
                add(kick_env, np.exp(-np.arange(int(0.3 * SR)) / SR * 10), t_of(bar, step))
            for step in (2, 6):
                add(drums, S * (0.9 + 0.2 * rng.random()), t_of(bar, step) + 0.012)
            for step in range(8):
                if rng.random() < 0.92:
                    add(drums, hat(open_=(step == 7 and b % 4 == 3)) * (1.0 if step % 2 == 0 else 0.6), t_of(bar, step) + rng.normal(0, 0.006))
        if has_lead:
            step = 0
            while step < 8:
                if rng.random() < 0.45:
                    n = rng.choice(PENTA)
                    ln = rng.choice([1, 2, 3])
                    add(lead, pluck(midi(n), ln * BEAT / 2, 0.3), t_of(bar, step))
                    step += ln
                else:
                    step += 1
        bar += 1

# keys: section-dependent low-pass (filtered intro/outro), done per section
k_out = np.zeros(length)
for c in np.unique(keys_cut[keys_cut > 0]):
    mask = (keys_cut == c).astype(float)
    mask = np.convolve(mask, np.ones(4410) / 4410, mode="same")  # smooth cross-over
    k_out += fft_filter(keys, hi=c) * mask
keys = k_out

# reverb IR: decaying stereo-ish noise
ir_t = np.arange(int(1.8 * SR)) / SR
ir = fft_filter(rng.normal(size=len(ir_t)), hi=5000) * np.exp(-ir_t * 3.2)
ir /= np.sqrt((ir ** 2).sum())
ir2 = fft_filter(rng.normal(size=len(ir_t)), hi=5000) * np.exp(-ir_t * 3.2)
ir2 /= np.sqrt((ir2 ** 2).sum())

duck = 1 - 0.35 * np.clip(kick_env, 0, 1)  # gentle sidechain pump
music = (keys * 0.55 + lead * 0.6) * duck
wetL, wetR = convolve(music, ir) * 0.35, convolve(music, ir2) * 0.35
drums = fft_filter(drums, hi=7500)
drums = np.round(drums * 64) / 64  # light bit-crush for grit
bass_t = fft_filter(bass_t, hi=900) * duck

delay = int(0.013 * SR)
keysR = np.concatenate([np.zeros(delay), music[:-delay]])
L = music + wetL + drums * 0.8 + bass_t * 0.7
R = keysR + wetR + drums * 0.8 + bass_t * 0.7

# vinyl crackle + hiss
crack = np.zeros(length)
idx = rng.integers(0, length, int(length / SR * 9))
crack[idx] = rng.normal(0, 0.35, len(idx))
crack = fft_filter(crack, lo=800, hi=6000)
hiss = fft_filter(rng.normal(size=length), lo=2000, hi=9000) * 0.006
L += crack + hiss
R += crack + hiss

# tape wow & flutter: tiny time warp
tt = np.arange(length) / SR
warp = tt + 0.0018 * np.sin(2 * np.pi * 0.45 * tt) + 0.0004 * np.sin(2 * np.pi * 5.5 * tt)
L, R = np.interp(warp, tt, L), np.interp(warp, tt, R)

# master: warm low-pass, soft clip, fades
L, R = fft_filter(L, lo=30, hi=9000), fft_filter(R, lo=30, hi=9000)
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = np.tanh(L / peak * 1.3) * 0.85, np.tanh(R / peak * 1.3) * 0.85
fade = np.minimum(1, np.minimum(tt / 1.5, (tt[-1] - tt) / 3.0))
stereo = np.stack([L * fade, R * fade], 1)

out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).with_name(f"lofi_{seed}.wav")
with wave.open(str(out), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((stereo * 32767).astype(np.int16).tobytes())
print("wrote", out, f"{length / SR:.1f}s")
