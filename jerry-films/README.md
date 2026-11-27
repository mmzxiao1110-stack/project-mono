# Jerry Films

Vertical (1080×1920) 3D explainer shorts about the most absurd "what if" questions, built
with **Remotion + three.js** (`@remotion/three`). No AI video models: every shot is code.

Episode 1: **What if you swallowed a rubber duck?** (~26 s)

## Pipeline

1. **Script**: `scripts/script.json` holds one line per beat, plus sound effects cued at offsets
   inside each line (`"squeak@0.8"` = squeak 0.8 s after that line starts).
2. **Audio**: `scripts/make_audio.py` voices each line with the
   [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) neural TTS (voice `am_michael`),
   synthesises the sound effects and a ducked music bed, and writes:
   - `public/audio.wav`: the final mix
   - `public/timeline.json`: when each line starts and how long it lasts. **Scenes are
     timed from this file**, so the visuals follow the narration automatically.
3. **Visuals**: `src/scenes/*.tsx` has one three.js scene per shot, each a pure function of time.
   `src/Video.tsx` cuts them together on the timeline and adds captions, badges and the end card.

## Setup

```bash
npm install
pip install kokoro-onnx soundfile
# voice model (~330 MB), kept outside the repo
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

## Make it

```bash
python3 scripts/make_audio.py scripts/script.json kokoro-v1.0.onnx voices-v1.0.bin public
npx remotion studio src/index.ts          # live preview / scrub
npx remotion render src/index.ts RubberDuck out/episode.mp4
```

`remotion.config.ts` uses software WebGL (`swangle`) so renders work without a GPU. On a
laptop with a GPU, remove that line and renders get much faster.

## House style

- Soft clay-like materials, cool blue-grey radial backdrop outside the body, deep red inside.
- Slow push-in cameras, quick cuts on each narration beat, a small shake on impacts.
- Captions: up to 3 words at a time, white with a heavy black outline, key nouns in yellow.
- Every episode ends on the **JERRY FILMS** card.
- Topics: a real body or physics fact, pushed to the most ridiculous scenario. The last
  line is the twist.

## New episode checklist

1. Write `script.json` with 5–8 short lines: a hook question, an escalation, then the twist.
2. Run `make_audio.py`, then check `timeline.json`.
3. Copy or adapt scenes in `src/scenes`, then wire them up in `Video.tsx` by line `id`.
4. Check single frames with `npx remotion still ... --frame=N`, then render.
