#!/bin/bash
# Contact sheet of review stills: pipeline/sheet.sh glow → out/glow/sheet.jpg
d="$(dirname "$0")/../out/$1/stills"
ffmpeg -y -loglevel error -pattern_type glob -i "$d/*.jpg" -vf "scale=270:480,tile=8x3:padding=4" -frames:v 1 "$d/../sheet.jpg"
echo "$d/../sheet.jpg"
