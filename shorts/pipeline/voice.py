"""Voice-over: Kokoro TTS per beat, then pitch + speed up with ffmpeg for the high kid voice.

Writes out/<story>/voice/NN.wav and out/<story>/timeline.json (beat starts, durations, word timings).
Usage: python3 pipeline/voice.py stories/glow.json
"""
import json, os, re, subprocess, sys
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEAD_IN = 0.35   # silence before the first line
GAP = 0.32       # silence after every line


def pitch_up(src, dst, pitch, tempo):
    # asetrate raises pitch AND speed together (the "chipmunk" trick); atempo then fine-tunes speed only.
    af = (f"silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
          f"silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
          f"asetrate=24000*{pitch},aresample=48000,atempo={tempo},"
          f"highpass=f=90,acompressor=threshold=-18dB:ratio=3:attack=5:release=80,volume=1.6")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-af", af, "-ac", "1", dst], check=True)


def word_times(text, dur):
    """Estimate when each word is spoken: share the line by letters, with extra weight for pauses."""
    words = text.split()
    weights = []
    for w in words:
        wt = len(re.sub(r"[^A-Za-z0-9']", "", w)) + 1.5
        if re.search(r"[,;:]$", w): wt += 3
        if re.search(r"[.!?]$", w): wt += 5
        weights.append(wt)
    total = sum(weights)
    out, t = [], 0.0
    for w, wt in zip(words, weights):
        d = dur * wt / total
        out.append({"w": w, "s": round(t, 3), "e": round(t + d, 3)})
        t += d
    return out


def main():
    story_path = sys.argv[1]
    story = json.load(open(story_path))
    name = os.path.splitext(os.path.basename(story_path))[0]
    out = os.path.join(ROOT, "out", name, "voice")
    os.makedirs(out, exist_ok=True)

    from kokoro_onnx import Kokoro
    k = Kokoro(os.path.join(ROOT, "models/kokoro-v1.0.int8.onnx"), os.path.join(ROOT, "models/voices-v1.0.bin"))

    t = LEAD_IN
    beats = []
    for i, b in enumerate(story["beats"]):
        spk = b.get("speaker", "narrator")
        v = story["voices"][spk]
        raw = os.path.join(out, f"{i:02d}_raw.wav")
        wav = os.path.join(out, f"{i:02d}.wav")
        if not os.path.exists(wav) or os.environ.get("FORCE"):
            samples, sr = k.create(b["text"], voice=v["voice"], speed=v.get("speed", 1.0), lang="en-us")
            sf.write(raw, samples, sr)
            pitch_up(raw, wav, v.get("pitch", 1.3), v.get("tempo", 1.0))
        info = sf.info(wav)
        vdur = info.frames / info.samplerate
        dur = vdur + GAP + b.get("hold", 0)
        beats.append({"i": i, "start": round(t, 3), "dur": round(dur, 3), "voice": f"voice/{i:02d}.wav",
                      "voiceDur": round(vdur, 3), "speaker": spk, "words": word_times(b["text"], vdur)})
        print(f"{i:02d} {t:6.2f}s +{dur:4.2f}s  {b['text']}")
        t += dur
    json.dump({"story": name, "duration": round(t + 0.2, 3), "beats": beats},
              open(os.path.join(ROOT, "out", name, "timeline.json"), "w"), indent=1)
    print(f"total {t:.2f}s")


if __name__ == "__main__":
    main()
