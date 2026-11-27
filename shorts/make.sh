#!/bin/bash
# One command, story → finished short:  ./make.sh glow   (stories/glow.json → out/glow/final.mp4)
# Add --stills to only render one review frame per beat (fast) instead of the whole video.
set -euo pipefail
cd "$(dirname "$0")"
S="$1"; shift || true
[ -f models/kokoro-v1.0.int8.onnx ] || ./setup.sh
python3 pipeline/voice.py "stories/$S.json"
if [[ " $* " == *" --stills "* ]]; then node pipeline/render.mjs "$S" --stills; ./pipeline/sheet.sh "$S"; exit; fi
python3 pipeline/audio.py "stories/$S.json"
node pipeline/render.mjs "$S" "$@"
ffmpeg -y -loglevel error -i "out/$S/video.mp4" -i "out/$S/mix.wav" -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart "out/$S/final.mp4"
echo "done → out/$S/final.mp4"
