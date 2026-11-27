"""Builds narration + sound design for a Jerry Films episode.
Usage: python make_audio.py <script.json> <kokoro.onnx> <voices.bin> <out_dir>
Writes out_dir/audio.wav and out_dir/timeline.json (scene start/duration in seconds)."""
import json, sys
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

SR = 24000
rng = np.random.default_rng(7)

def env(n, a=0.01, r=0.1):
    e = np.ones(n); ai, ri = min(int(a*SR), n//2), min(int(r*SR), n//2)
    if ai: e[:ai] = np.linspace(0, 1, ai)
    if ri: e[-ri:] *= np.linspace(1, 0, ri)
    return e

def lowpass(x, k):
    return np.convolve(x, np.ones(k)/k, mode="same")

def squeak(dur=0.22, f0=1400, f1=2100, vol=0.35):
    n = int(dur*SR); t = np.arange(n)/SR
    f = np.interp(t, [0, dur*0.3, dur], [f0, f1, f0*1.1])
    ph = 2*np.pi*np.cumsum(f)/SR
    vib = 1 + 0.03*np.sin(2*np.pi*28*t)
    s = np.sin(ph*vib) + 0.4*np.sin(2*ph*vib) + 0.15*np.sin(3*ph)
    return vol*s*env(n, 0.01, 0.06)

def whoosh(dur=0.9, vol=0.3):
    n = int(dur*SR); x = rng.standard_normal(n)
    out = np.zeros(n)
    for i, k in enumerate(np.linspace(40, 6, 8)):
        seg = slice(i*n//8, (i+1)*n//8); out[seg] = lowpass(x, int(k))[seg]
    return vol*out/np.abs(out).max()*np.hanning(n)

def gulp(vol=0.5):
    n = int(0.35*SR); t = np.arange(n)/SR
    f = np.interp(t, [0, 0.35], [180, 70]); ph = 2*np.pi*np.cumsum(f)/SR
    return vol*np.sin(ph)*np.exp(-t*9)

def bubbles(dur=2.0, vol=0.22):
    n = int(dur*SR); out = np.zeros(n)
    for _ in range(int(dur*9)):
        st = rng.integers(0, n-3000); m = rng.integers(1200, 2800); t = np.arange(m)/SR
        f = rng.uniform(300, 900)*(1+t*14)
        out[st:st+m] += np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*40)*rng.uniform(.3, 1)
    return vol*out/np.abs(out).max()

def splash(vol=0.45):
    n = int(0.8*SR); t = np.arange(n)/SR
    g = gulp(0.35)
    return vol*lowpass(rng.standard_normal(n), 5)*np.exp(-t*6) + np.pad(g, (0, n-len(g)))

def squish(vol=0.4):
    n = int(0.45*SR); t = np.arange(n)/SR
    x = lowpass(rng.standard_normal(n), 30)*np.sin(np.pi*t/0.45)
    return vol*x/np.abs(x).max()

def hiccup(vol=0.5):
    n = int(0.12*SR); t = np.arange(n)/SR
    return vol*np.sin(2*np.pi*np.interp(t, [0, .12], [500, 260])*t)*np.exp(-t*30)

SFX = {"squeak": squeak, "bigsqueak": lambda: squeak(0.55, 1100, 2600, 0.5), "whoosh": whoosh,
       "gulp": gulp, "bubbles": bubbles, "splash": splash, "squish": squish, "hiccup": hiccup}

def music(total):
    """Soft, slightly mysterious pad + pluck bed, ducked under the voice."""
    n = int(total*SR); t = np.arange(n)/SR; out = np.zeros(n)
    chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 207.7, 246.9]]
    for i in range(int(total/2)+1):
        ch = chords[i % 4]; st = int(i*2*SR); m = min(int(2.2*SR), n-st)
        if m <= 0: break
        tt = np.arange(m)/SR
        for f in ch:
            out[st:st+m] += 0.05*np.sin(2*np.pi*f*tt)*env(m, 0.4, 0.6)
        for j in range(4):  # plucks
            ps = st+int(j*0.5*SR); pm = min(int(0.4*SR), n-ps)
            if pm <= 0: continue
            pt = np.arange(pm)/SR
            out[ps:ps+pm] += 0.06*np.sin(2*np.pi*ch[j % 3]*2*pt)*np.exp(-pt*8)
    return out

def main(script_path, model, voices, out_dir):
    spec = json.load(open(script_path))
    k = Kokoro(model, voices)
    gap, lead = 0.35, 0.3
    clips, scenes, cursor = [], [], lead
    for line in spec["lines"]:
        samples, sr = k.create(line["text"], voice=spec["voice"], speed=spec["speed"], lang="en-us")
        assert sr == SR
        d = len(samples)/SR
        scenes.append({"id": line["id"], "text": line["text"], "start": round(cursor, 3), "voiceDur": round(d, 3)})
        clips.append((cursor, samples, line.get("sfx", [])))
        cursor += d + gap
    total = cursor + 1.2
    for i, s in enumerate(scenes):
        nxt = scenes[i+1]["start"] if i+1 < len(scenes) else total
        s["dur"] = round(nxt - s["start"], 3)
    n = int(total*SR); voice = np.zeros(n); fx = np.zeros(n)
    for st, smp, sfx in clips:
        a = int(st*SR); voice[a:a+len(smp)] += smp
        for item in sfx:
            name, off = item.split("@"); s = SFX[name](); b = int((st+float(off))*SR)
            fx[b:b+len(s)] += s[:n-b]
    duck = 1 - 0.6*np.clip(lowpass(np.abs(voice) > 0.01, 4800)*3, 0, 1)
    mix = voice*1.0 + fx*0.8 + music(total)*duck
    mix = mix/np.abs(mix).max()*0.92
    sf.write(f"{out_dir}/audio.wav", mix, SR)
    json.dump({"title": spec["title"], "fps": 30, "total": round(total, 3), "scenes": scenes},
              open(f"{out_dir}/timeline.json", "w"), indent=2)
    print(json.dumps(scenes, indent=1), total)

if __name__ == "__main__":
    main(*sys.argv[1:5])
