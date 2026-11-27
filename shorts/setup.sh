#!/bin/bash
# One-time setup: JS deps (three.js, caption font), Kokoro TTS + its model files. Needs ffmpeg and Chromium/Playwright.
set -euo pipefail
cd "$(dirname "$0")"
npm install
pip install kokoro-onnx soundfile numpy
mkdir -p models
B=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
[ -f models/kokoro-v1.0.int8.onnx ] || curl -L -o models/kokoro-v1.0.int8.onnx $B/kokoro-v1.0.int8.onnx
[ -f models/voices-v1.0.bin ] || curl -L -o models/voices-v1.0.bin $B/voices-v1.0.bin
