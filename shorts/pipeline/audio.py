"""Music + sound effects composed in code, mixed under the voice-over.

Reads the story (moods, sfx cues) and out/<story>/timeline.json; writes out/<story>/mix.wav.
Usage: python3 pipeline/audio.py stories/glow.json
"""
import json, os, sys
import numpy as np
import soundfile as sf

SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rng = np.random.default_rng(7)

def tt(d): return np.arange(int(d * SR)) / SR
def midi(n): return 440.0 * 2 ** ((n - 69) / 12)
def env(n, a=0.005, r=0.3):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / r)
    return e

# ---------------- instruments ----------------
def piano(f, d, vel=0.5):
    t = tt(d)
    s = sum(np.sin(2 * np.pi * f * k * t + k) * (0.6 ** (k - 1)) * np.exp(-t * (1.2 + k * 0.9)) for k in range(1, 6))
    return vel * s * np.minimum(1, t / 0.004)

def pluck(f, d, vel=0.5):
    t = tt(d)
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * np.sign(np.sin(2 * np.pi * f * t))
    return vel * s * np.exp(-t * 9) * np.minimum(1, t / 0.002)

def pad(f, d, vel=0.2):
    t = tt(d)
    s = sum(np.sin(2 * np.pi * f * (1 + det) * t) for det in (-0.004, 0, 0.005)) / 3
    s += 0.3 * np.sin(4 * np.pi * f * t)
    a = np.minimum(1, t / 0.6) * np.minimum(1, (d - t) / 0.6)
    return vel * s * a

def bass(f, d, vel=0.4):
    t = tt(d)
    return vel * (np.sin(2 * np.pi * f * t) + 0.2 * np.sin(4 * np.pi * f * t)) * np.exp(-t * 2.5) * np.minimum(1, t / 0.01)

def hat(vel=0.08):
    n = int(0.05 * SR); x = rng.standard_normal(n)
    x = np.diff(x, prepend=0)  # crude high-pass
    return vel * x * env(n, 0.001, 0.015)

def kick(vel=0.6):
    t = tt(0.3); f = 50 + 90 * np.exp(-t * 30)
    return vel * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)

def put(buf, x, at):
    i = int(at * SR)
    if i >= len(buf) or i + len(x) <= 0: return
    j = min(len(buf), i + len(x)); buf[max(0, i):j] += x[max(0, -i):j - i]

# ---------------- music moods ----------------
CHORDS = {
    'playful': (112, [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]]),
    'sad':     (68,  [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]),
    'tense':   (60,  [[50, 53, 57], [50, 53, 56], [49, 53, 56], [50, 53, 57]]),
    'hopeful': (82,  [[53, 57, 60], [55, 59, 62], [57, 60, 64], [60, 64, 67]]),
}

def music(mood, dur, intensity=1.0):
    bpm, prog = CHORDS[mood]
    beat = 60 / bpm; bar = beat * 4
    out = np.zeros(int((dur + 3) * SR))
    nbars = int(dur / bar) + 2
    for b in range(nbars):
        ch = prog[b % len(prog)]; t0 = b * bar
        if mood == 'playful':
            for k in range(8):
                put(out, pluck(midi(ch[k % 3] + 12 * (k // 3 % 2)), 0.3, 0.22), t0 + k * beat / 2)
            for k in range(4): put(out, bass(midi(ch[0] - 24), beat * 0.9, 0.35), t0 + k * beat)
            for k in range(8): put(out, hat(0.05 if k % 2 else 0.08), t0 + k * beat / 2)
            put(out, kick(0.35), t0); put(out, kick(0.3), t0 + 2 * beat)
        elif mood == 'sad':
            for k, n in enumerate([0, 1, 2, 1, 2, 1, 0, 1]):
                put(out, piano(midi(ch[n] + 12), 1.6, 0.16), t0 + k * beat / 2)
            put(out, piano(midi(ch[0] - 12), bar, 0.22), t0)
            put(out, pad(midi(ch[0]), bar + 0.6, 0.07), t0)
        elif mood == 'tense':
            put(out, pad(midi(ch[0] - 12), bar + 0.6, 0.16), t0)
            put(out, pad(midi(ch[2]), bar + 0.6, 0.05), t0)
            for k in range(4):
                put(out, kick(0.45), t0 + k * beat); put(out, kick(0.25), t0 + k * beat + 0.18)
        elif mood == 'hopeful':
            lift = min(1.0, 0.5 + b / 8) * intensity
            for k, n in enumerate([0, 2, 1, 2, 0, 2, 1, 2]):
                put(out, piano(midi(ch[n] + 12), 1.4, 0.16 * lift), t0 + k * beat / 2)
            if b % 2 == 1: put(out, piano(midi(ch[2] + 24), 2, 0.1 * lift), t0 + beat * 2)
            put(out, bass(midi(ch[0] - 24), bar, 0.3 * lift), t0)
            for n in ch: put(out, pad(midi(n), bar + 0.6, 0.06 * lift), t0)
    return out[:int(dur * SR)]

# ---------------- sound effects ----------------
def sfx(name):
    if name == 'whoosh':
        t = tt(0.45); n = rng.standard_normal(len(t))
        f = np.convolve(n, np.ones(6) / 6, 'same')
        return 0.35 * f * np.sin(np.pi * t / 0.45) ** 2
    if name == 'shimmer':
        out = np.zeros(int(1.4 * SR))
        for k, n in enumerate([84, 88, 91, 96, 100]):
            x = tt(1.0); put(out, 0.12 * np.sin(2 * np.pi * midi(n) * x) * np.exp(-x * 4) * (1 + 0.3 * np.sin(2 * np.pi * 7 * x)), k * 0.06)
        return out
    if name == 'pop':
        t = tt(0.12); f = 300 + 900 * t / 0.12
        return 0.4 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 30)
    if name == 'ding':
        t = tt(1.2); return 0.25 * (np.sin(2 * np.pi * 1568 * t) + 0.4 * np.sin(2 * np.pi * 3136 * t)) * np.exp(-t * 3.5)
    if name == 'flicker':
        t = tt(0.4); buzz = np.sign(np.sin(2 * np.pi * 120 * t)) * 0.5 + 0.3 * rng.standard_normal(len(t))
        gate = (np.sin(2 * np.pi * 14 * t + rng.random() * 6) > 0).astype(float)
        return 0.12 * buzz * gate * np.exp(-t * 4)
    if name == 'boom':
        t = tt(2.0); f = 40 + 60 * np.exp(-t * 6)
        return 0.7 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2) * np.minimum(1, t / 0.005)
    if name == 'thunder':
        t = tt(2.6); n = np.convolve(rng.standard_normal(len(t)), np.ones(40) / 40, 'same')
        return 0.9 * n * np.exp(-t * 1.6) * (0.6 + 0.4 * np.sin(2 * np.pi * 3 * t))
    if name == 'powerdown':
        t = tt(1.1); f = 600 * np.exp(-t * 3)
        return 0.25 * np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * np.exp(-t * 2) * 0.6
    if name == 'clink':
        t = tt(0.5); return 0.2 * (np.sin(2 * np.pi * 2637 * t) + np.sin(2 * np.pi * 3520 * t)) * np.exp(-t * 12)
    if name == 'giggle':
        out = np.zeros(int(0.9 * SR))
        for k in range(5):
            x = tt(0.11); f = 700 + 150 * np.sin(2 * np.pi * 25 * x)
            put(out, 0.12 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * x / 0.11), k * 0.15)
        return out
    if name == 'rise':
        t = tt(2.2); f = 200 * 2 ** (t * 1.6)
        return 0.12 * np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / 2.2) ** 2
    raise ValueError('unknown sfx ' + name)


def main():
    story = json.load(open(sys.argv[1]))
    name = os.path.splitext(os.path.basename(sys.argv[1]))[0]
    d = os.path.join(ROOT, 'out', name)
    tl = json.load(open(os.path.join(d, 'timeline.json')))
    N = int((tl['duration'] + 0.5) * SR)
    voice = np.zeros(N); fx = np.zeros(N); mus = np.zeros(N)

    # voice
    for b in tl['beats']:
        v, sr = sf.read(os.path.join(d, b['voice']))
        if v.ndim > 1: v = v.mean(1)
        assert sr == SR
        put(voice, v, b['start'])
    # sfx
    for sb, b in zip(story['beats'], tl['beats']):
        for s in sb.get('sfx', []):
            put(fx, sfx(s['name']) * s.get('gain', 1.0), b['start'] + s.get('at', 0) * b['dur'])
    # music: contiguous mood segments, short crossfades
    mood, segs = None, []
    for sb, b in zip(story['beats'], tl['beats']):
        mood = sb.get('music', mood)
        if segs and segs[-1][0] == mood: segs[-1][2] = b['start'] + b['dur']
        else: segs.append([mood, b['start'], b['start'] + b['dur']])
    segs[-1][2] = tl['duration'] + 0.5
    for m, s0, s1 in segs:
        x = music(m, s1 - s0 + 0.3)
        fade = int(0.25 * SR); x[:fade] *= np.linspace(0, 1, fade); x[-fade:] *= np.linspace(1, 0, fade)
        put(mus, x, s0)
    # duck music under the voice
    venv = np.convolve(np.abs(voice), np.ones(SR // 20) / (SR // 20), 'same')
    duck = 1 - 0.45 * np.clip(venv / (venv.max() * 0.25 + 1e-9), 0, 1)
    tail = int(1.2 * SR); mus[-tail:] *= np.linspace(1, 0, tail)
    mix = voice * 1.0 + fx * 0.8 + mus * 0.55 * duck
    mix /= max(1e-9, np.abs(mix).max()) / 0.92
    stereo = np.stack([mix, mix], 1)
    sf.write(os.path.join(d, 'mix.wav'), stereo, SR)
    print('mix →', os.path.join(d, 'mix.wav'), f'{N / SR:.1f}s')


if __name__ == '__main__':
    main()
