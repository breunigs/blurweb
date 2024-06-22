// @ts-check

import { Metadata } from "./video_metadata.js"
import { FFmpegWrapper } from "./ffmpeg_wrapper.js"
import { Progress } from './progress.js'
import { EncoderInterface } from "./video_encoder_interface.js"

/** @implements {EncoderInterface} */
export class VideoEncoderFFmpeg {
  /** @type { Metadata } #videoMeta */
  #videoMeta

  /** @type { FFmpegWrapper } #videoMeta */
  #ffmpegWrapper

  /** @type { string } #pathPrefix */
  #pathPrefix

  /** @type { Number } #keyFrameInterval */
  #keyFrameInterval

  /** @type { Number } #frameIndex */
  #frameIndex = 0

  /** @type { Array<string> } #framePaths */
  #framePaths = []

  /** @type { Array<string> } #chunkPaths */
  #chunkPaths = []

  /** @type { boolean } #flushed */
  #flushed = false

  /** @type { Progress } #pbar */
  #pbar

  /**
 * @param {FFmpegWrapper} ffmpegWrapper
 * @param {string} pathPrefix
 * @param {Metadata} videoMeta
 * @param {Number} keyFrameInterval
 * @param {Progress} pbar
 */
  constructor(ffmpegWrapper, pathPrefix, videoMeta, keyFrameInterval, pbar) {
    this.#ffmpegWrapper = ffmpegWrapper
    this.#videoMeta = videoMeta
    this.#keyFrameInterval = keyFrameInterval
    this.#pathPrefix = pathPrefix
    this.#pbar = pbar
  }

  /** @param {Uint8Array | Uint8ClampedArray} blob */
  async encode(blob) {
    if (this.#flushed) throw new Error("Cannot encode more frames after flushing")

    const tmpPath = `${this.#pathPrefix}_${this.#frameIndex}.raw`
    this.#framePaths.push(tmpPath)
    await this.#ffmpegWrapper.write(tmpPath, blob)
    this.#frameIndex++

    if ((this.#frameIndex % this.#keyFrameInterval) === 0) await this.#encodeSegment()
  }

  async #encodeSegment() {
    if (this.#framePaths.length === 0) return

    const chunkName = `${this.#pathPrefix}_chunk_${this.#chunkPaths.length}.ts`
    this.#chunkPaths.push(chunkName)
    this.#pbar.reset().cur(0).max(1.0).describe("encode segment")

    await this.#ffmpegWrapper.exec([
      "-framerate", this.#videoMeta.fpsRatio,
      "-video_size", `${this.#videoMeta.width}x${this.#videoMeta.height}`,
      "-pix_fmt", "bgr32",
      "-f", "rawvideo",
      "-i", `concat:${this.#framePaths.join("|")}`,
      // TODO: needed? read from source?
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-colorspace', 'bt709',
      // hardcoded for highest compatibility
      // "-pix_fmt", this.#videoMeta.pixFmt,
      "-pix_fmt", "yuv420p",
      '-c:v:0', 'libx264',
      '-preset:0', 'ultrafast',
      '-r:0', this.#videoMeta.fpsRatio,
      chunkName
    ], this.#pbar)

    this.#pbar.finish().hide()

    this.#framePaths.map((file) => this.#ffmpegWrapper.delete(file))
    this.#framePaths = []
  }

  isSupported() {
    return Promise.resolve(true)
  }

  /** @returns {Promise<Array<string>>} */
  async flush() {
    if (this.#flushed) throw new Error("Cannot flush more than once")
    await this.#encodeSegment()
    return this.#chunkPaths
  }

  async destroy() {
    this.#framePaths.map((file) => this.#ffmpegWrapper.delete(file))
    this.#framePaths = []
    this.#chunkPaths.map((file) => this.#ffmpegWrapper.delete(file))
    this.#chunkPaths = []
    this.#flushed = true
  }
}
