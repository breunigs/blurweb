// @ts-check

import { Blurrer } from './blurrer.js'
import { DetectionCache } from './detection_cache.js'
import { App } from './app.js';

let errors = []
if (!("SharedArrayBuffer" in window)) errors.push("SharedArrayBuffer")

if (errors.length > 0) {
  alert(`Browser lacks support for required features:
* ${errors.join("\n *")}

The website will NOT work.

Potential solutions:
* update your browser to the latest version
* use a different browser
* use a laptop or desktop computer instead of mobile device
* disable privacy/safety tools like NoScript for this website
* (developer) ensure site is served from secure context (https or localhost)
* (developer) ensure the site is served with the appropriate headers, see serve.json in source code`)
} else {
  const isProbablyMobileDevice = ("maxTouchPoints" in navigator) && navigator.maxTouchPoints > 0

  // How many blur masks (i.e. rounded rectangles) to keep in memory.
  const BLUR_MASK_CACHE_SIZE = isProbablyMobileDevice ? 10 : 100

  // Which key to save the detections under
  const LOCAL_STORAGE_KEY = "detectionCache"

  // Allow usage of multi-threaded WASM for ffmpeg/onnx-web. Requires more
  // memory, so should be off for mobile devices. Additionally, iOS/onnx-web are
  // buggy on multi-threaded WASM:
  // https://github.com/microsoft/onnxruntime/issues/11679
  const USE_MULTI_THREADING = !isProbablyMobileDevice

  const blurrer = new Blurrer(BLUR_MASK_CACHE_SIZE)
  const cache = new DetectionCache(LOCAL_STORAGE_KEY)

  // @ts-ignore
  window.app = new App(blurrer, cache, USE_MULTI_THREADING)
}



