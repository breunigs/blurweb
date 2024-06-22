#!/bin/bash

set -eu

trap "trap - SIGTERM && kill -- -$$" SIGINT SIGTERM EXIT

./build.sh

(
  while [ 1 ]; do
    LC_NUMERIC="C" # work around https://github.com/emcrisostomo/fswatch/issues/166
    fswatch --latency 0.4 --one-event --event Updated --event Created src/
    cp src/* dist/
  done
)&

npx serve --no-clipboard --config ../serve.json ./dist/ $@


