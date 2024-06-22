// @ts-check

import { Metadata } from "./video_metadata.js"
import { FFmpegWrapper } from "./ffmpeg_wrapper.js"
import { EncoderInterface } from "./video_encoder_interface.js"
import { Progress } from "./progress.js"

/** @implements {EncoderInterface} */
export class VideoEncoderWebCodecs {
  /** @type { Metadata } #videoMeta */
  #videoMeta

  /** @type VideoPixelFormat */
  #format = "RGBA"

  /** @type { Number } #keyFrameInterval */
  #keyFrameInterval

  /** @type { Number } #frameIndex */
  #frameIndex = 0

  /** @type { boolean } #flushed */
  #flushed = false


  /** @type { string } #pathPrefix */
  #pathPrefix

  /** @type { FFmpegWrapper } #ffmpegWrapper */
  #ffmpegWrapper

  /** @type { Array<Promise<string>> } #chunkPaths */
  #chunkPaths = []

  /** @type { Promise<VideoEncoder | null> } #encoder */
  #encoder

  /**
   * @param {FFmpegWrapper} ffmpegWrapper
   * @param {string} pathPrefix
   * @param {Metadata} videoMeta
   * @param {Number} keyFrameInterval
   * @param {Progress} _pbar
   */
  constructor(ffmpegWrapper, pathPrefix, videoMeta, keyFrameInterval, _pbar) {
    this.#ffmpegWrapper = ffmpegWrapper
    this.#pathPrefix = pathPrefix

    this.#videoMeta = videoMeta
    this.#keyFrameInterval = keyFrameInterval
    this.#encoder = this.#createVideoEncoder()
  }

  async isSupported() {
    return !!(await this.#encoder)
  }

  /** @param {Uint8Array |  Uint8ClampedArray} blob */
  async encode(blob) {
    const enc = await this.#encoder
    if (!enc) throw new Error("WebCodec encoding is not supported")

    if (this.#flushed) throw new Error("Cannot encode more frames after flushing")

    const init = {
      timestamp: this.#frameIndex * 1 / this.#videoMeta.fps * 1000,
      codedWidth: this.#videoMeta.width,
      codedHeight: this.#videoMeta.height,
      format: this.#format,
      transfer: [blob.buffer],
    };

    const frame = new VideoFrame(blob, init)
    const keyFrame = (this.#frameIndex % this.#keyFrameInterval) === 0
    enc.encode(frame, { keyFrame })
    frame.close()
    await enc.flush()

    this.#frameIndex++
  }

  /** @returns {Promise<Array<string>>} */
  async flush() {
    const enc = await this.#encoder
    if (!enc) throw new Error("WebCodec encoding is not supported")

    if (this.#flushed) throw new Error("Cannot flush more than once")
    this.#flushed = true

    console.debug("waiting for video encode to finish")
    await enc.flush()
    enc.close()

    return Promise.all(this.#chunkPaths)
  }

  #handleChunk() {
    return async (chunk, _metadata) => {
      const chunkData = new Uint8Array(chunk.byteLength);
      chunk.copyTo(chunkData)

      const chunkName = `${this.#pathPrefix}_chunk_${this.#chunkPaths.length}.rawcodec`

      this.#chunkPaths.push(new Promise((resolve, _reject) => {
        this.#ffmpegWrapper.write(chunkName, chunkData).then(() => resolve(chunkName))
      }))
    }
  }

  async #createVideoEncoder() {
    if (!('VideoEncoder' in window)) {
      console.debug("WebCodecs video encoding not supported")
      return null
    }

    /** @type {AvcBitstreamFormat} avcFormat */
    const avcFormat = "annexb"
    const avcOpts = {
      avc: { format: avcFormat },
      bitrate: 20_000_000, // 20 Mbps
      bitrateMode: "constant"
    }

    const videoMeta = await this.#videoMeta
    const codecs = [
      ["av01.0.08M.08", {}],
      ["av01.0.05M.08", {}],
      ["av01.0.01M.08", {}],
      ["avc1.640032", avcOpts],
      ["avc1.640034", avcOpts],
      ["avc1.64001f", avcOpts],
      ["avc1.42F01E", avcOpts],
    ]

    /** @type {Array<HardwareAcceleration>} accels */
    const accels = ["prefer-hardware", "prefer-software"]

    for (let accel of accels) {
      for (let [codec, opts] of codecs) {
        const candidate = {
          codec: codec,
          avc: { format: avcFormat },
          width: videoMeta.width,
          height: videoMeta.height,
          framerate: videoMeta.fps,
          hardwareAcceleration: accel,
        }
        Object.assign(candidate, opts);

        let encoder = await this.#tryCreateVideoEncoder(candidate).catch((reason) => {
          console.debug(reason, candidate)
          return null
        })
        if (encoder) {
          console.info("WebCodecs encoder can use config", candidate)
          return encoder
        }
      }
    }

    return null
  }


  /** @returns {Promise<VideoEncoder>} */
  #tryCreateVideoEncoder(config) {
    return new Promise(async (resolve, reject) => {
      try {
        const { supported } = await VideoEncoder.isConfigSupported(config)
        if (!supported) return reject("config not supported")
      } catch (e) {
        reject("invalid webcodecs encoder config given")
        return
      }

      console.debug("WebCodecs video encoding potentially supports", config)

      const init = {
        output: this.#handleChunk(),
        error: (e) => reject(`WebCodecs VideoEncoder failed: ${e.message}`)
      }

      let encoder = new VideoEncoder(init)
      try {
        encoder.configure(config)
      } catch (e) {
        reject("WebCodecs video encoder configure failed")
        return
      }

      const stateChecker = () => {
        switch (encoder.state) {
          case "unconfigured":
            // let's wait
            break
          case "configured":
            resolve(encoder)
            return
          case "closed":
            reject("WebCodecs video encoder configure was closed during configure")
            return
          default:
            throw new Error("unexpected WebCodecs VideoEncoder state")
        }
        setTimeout(stateChecker, 100)
      }
      setTimeout(stateChecker, 0)
    })
  }

  async destroy() {
    const enc = await this.#encoder
    if (enc && enc.state !== "closed") enc.close()
    this.#flushed = true

    this.#chunkPaths.map((prom) => prom.then(path => this.#ffmpegWrapper.delete(path)))
  }
}
