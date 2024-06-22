#!/bin/bash

set -eux

npm install --no-fund --no-audit --no-bin-links --omit dev --omit optional

mkdir -p .cache/
if [ ! -f ".cache//mp4box.all.min.js" ]; then
  wget --output-document .cache/mp4box.all.min.js https://gpac.github.io/mp4box.js/dist/mp4box.all.min.js
fi

rm -rf dist/
mkdir -p dist/onnx/ dist/ffmpeg/ dist/ffmpeg-util/ dist/ffmpeg-core-st/ dist/ffmpeg-core-mt/

cp src/* dist/

cp ./node_modules/onnxruntime-web/dist/esm/ort.{,all.,webgpu.,wasm.}min.js{,.map} dist/onnx/
cp ./node_modules/onnxruntime-web/dist/*.wasm dist/onnx/

cp ./node_modules/@ffmpeg/ffmpeg/dist/esm/*.js dist/ffmpeg/

cp ./node_modules/@ffmpeg/util/dist/esm/*.js dist/ffmpeg-util/

cp ./node_modules/@ffmpeg/core/dist/esm/*.js   dist/ffmpeg-core-st/
cp ./node_modules/@ffmpeg/core/dist/esm/*.wasm dist/ffmpeg-core-st/
# hangs in chromium browsers :(
cp ./node_modules/@ffmpeg/core-mt/dist/esm/*.js   dist/ffmpeg-core-mt/
cp ./node_modules/@ffmpeg/core-mt/dist/esm/*.wasm dist/ffmpeg-core-mt/

cp ./node_modules/stackblur-canvas/dist/stackblur-es.min.js dist/stackblur.js

cp .cache/mp4box.all.min.js dist/

cp assets/*.mp4 dist/
cp assets/*.onnx dist/
cp assets/*.onnx.* dist/
