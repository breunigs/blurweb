# BlurWeb

Detect people and license plate from videos, blur them, and re-encode the video.
*Locally*.

### [visit demo page](https://www.breunig.xyz/share/blurweb/)

## Running Locally

```bash
sudo apt install npm wget bash firefox chromium
./serve.sh
# Note: use the localhost address shown. The http://some.ip.here one won't work.

# Firefox
firefox http://localhost:3000
# recommend enabling `dom.media.webcodecs.enabled` (available in stable)
# recommend enabling `dom.webgpu.enabled` (available in nightly)

# Chromium
chromium --enable-features=Vulkan --enable-unsafe-webgpu http://localhost:3000
```

## Development

The project uses vanilla JavaScript with light TypeScript annotations via JSDoc.
This choice is intentional to avoid the complexity spike that comes with
introducing *any* JavaScript bundler/compiler.

There is still a build step to download the dependencies and copy them into the
expected folders. See `build.sh`.

You'll need to serve the files through a web server, since browsers require
additional HTTP headers to enable the APIs used for security reasons. See
`serve.sh` and `serve.json`. They automatically re-run the `build.sh` when file
changes are detected, but you'll need to reload the browser page manually.

## Runtime Dependencies

* [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) -- to run the
  detection models (license: MIT)
* [StackBlur](https://github.com/flozz/StackBlur) -- blurring algorithm (license: MIT)
* [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) -- various video
  en/decoding bits  (license: MIT, but the included encoders/decoders have
  various different licenses)
* [MP4Box.js](https://github.com/gpac/mp4box.js/) -- parsing MP4 files for use
  with WebCodecs instead of FFmpeg  (license: BSD-3-clause)

## Build/Bootstrapping Dependencies

* [YoloV5](https://github.com/ultralytics/yolov5) -- to train the detection
  models (license: AGPL). Dataset is custom and available upon request.
* [NPM](https://www.npmjs.com/) -- Javascript dependency manager (license:
  various)
* Standard unix tools like `bash` or `wget`
* OpenSSL if you want to use `serve_ssl.sh` (useful to debug on mobile devices)

## Code Overview

Files for the actual application are located in `src/`. Files generated outside
of this project are located in `assets/`. All get combined using the `build.sh`
and put into `dist/`.

Details for `src/`:

- UI related
  - `index.html` -- the UI page
  - `style.css` -- take a guess
  - `main.js` -- hardcoded config and object setup.
  - `app.js` -- the UI / business logic. Cobbled together because I didn't
    want to invest time to learn modern JS-SPA frameworks.
  - `progress.js` -- progress bar helper class
- Detection related
  - `model.js` -- defines the `Model` class. Includes metadata for models
    shipped in `assets/*.onnx`.
  - `box.js` -- class to hold metadata for detected entity
  - `detection_cache.js` -- convenience wrapper to store detection results in
    `localStorage`
  - `detector_worker.js` -- web worker that runs the actual inference
    (detection), including necessary pre- and postprocessing steps
  - `detector.js` -- provides the API for `detector_worker.js` on main thread
- Video related
  - `ffmpeg_wrapper.js` -- convenience wrapper around ffmpeg.wasm
  - `blurrer.js` -- blurs `Box`es (areas) on a `Canvas`
  - `video.js` -- video demuxing, decoding, encoding and muxing. Uses WebCodecs
    when possible for speed, or ffmpeg.wasm as a fallback. Some tasks are always
    done using ffmpeg.wasm.
  - `video_*.js` -- extracts from `video.js` for re-use or to avoid nesting
      too functions too deep
- `util.js` -- miscellaneous


