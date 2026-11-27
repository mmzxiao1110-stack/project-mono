# Shorts: blocky 3D story animations from one JSON file

This pipeline makes vertical (1080×1920) story shorts in the style of "one town, one strange rule, one kid". You write one story file and get back a finished MP4 with a voice-over, word-by-word captions, music and sound effects.
Everything is built in code. You don't need Blender, Roblox Studio or any paid API.

| Part | How |
|---|---|
| Characters, town, props | Three.js, built from rounded boxes (`engine/characters.js`, `engine/town.js`) |
| Animation, cameras, lighting | Pure function of time (`engine/main.js`): walk cycles, poses, glow/flicker, push/orbit/track/over-shoulder shots, day/dusk/night, power cuts |
| Captions + pop-up stamps | 2D canvas layer composited over each frame (`engine/overlay.js`), Luckiest Guy font |
| Voice | Kokoro TTS (offline, neural), then raised pitch and speed with ffmpeg `asetrate` for the high "kid" voice (`pipeline/voice.py`) |
| Music + SFX | Synthesised with numpy, with moods `playful` / `sad` / `tense` / `hopeful`. The music ducks under the voice (`pipeline/audio.py`) |
| Render | Headless Chromium renders frames in parallel workers and pipes them to ffmpeg/x264 (`pipeline/render.mjs`) |

## Use

```bash
./setup.sh                 # once: npm deps, Kokoro + model files (~120 MB)
./make.sh glow --stills    # fast review: one frame per beat → out/glow/sheet.jpg
./make.sh glow             # full video → out/glow/final.mp4  (~1 s/frame on CPU)
```

## Writing a new story

Copy `stories/glow.json`. Each beat is one narrated line plus the shot that goes with it:

```json
{ "text": "He hasn't glowed in eleven years.",
  "time": "dusk", "music": "sad", "hold": 0.5,
  "actors": { "abbott": { "at": [56, -10.5], "face": 0, "pose": "sit", "expr": "sad", "glow": 0 } },
  "cam": { "shot": "close", "on": "abbott", "angle": 12, "move": "push" },
  "overlay": { "text": "11 YEARS", "at": 0.45 },
  "sfx": [{ "name": "boom", "at": 0.45 }] }
```

- **actors**: `at`/`to` [x, z] (walks between them), `face` (degrees, `"move"`, or another actor's id), `pose` (`idle wave point speech sit hold shoulder think`), `expr` (`smile smallsmile grin laugh sad cry teary meh dreamy squint surprised determined`), `glow` / `glowFrom` / `flicker`, `prop` (`pizza newspaper tea photo`), `talk`, `think`, `podium`.
- **cam**: either `shot` (`close medium wide low ots`) `on` an actor with `angle`, or an explicit `pos`/`look`. `move` can be `push pullback orbit track static`. Walls, trees or people between the camera and the subject get hidden automatically.
- **time** (`day dusk night`), **music** and the cast's looks carry over from beat to beat. `lightsOut` (0–1) cuts the town's power partway through a beat.
- **speaker** picks a voice from `voices` (Kokoro voice + `pitch` + `tempo`).
- Town map: the road runs along x from −66 to 66. The sidewalks are at z = ±5.3 and the yards at z = ±9. The mayor's stage is at x ≈ −78, and the porch with its bench is at (56, −10.5).

The glow/flicker effect can stand in for other rules too: shrink, float, colour change. Add an actor property in `applyActor` (`engine/main.js`).
