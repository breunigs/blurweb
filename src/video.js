// @ts-check

import { FFmpegWrapper } from './ffmpeg_wrapper.js'
import { Metadata } from "./video_metadata.js"
import { VideoEncoderWebCodecs } from "./video_encoder_webcodecs.js"
import { VideoEncoderFFmpeg } from "./video_encoder_ffmpeg.js"
import { Progress } from './progress.js'
// @ts-ignore
import { fetchFile } from './ffmpeg-util/index.js'
import { EncoderInterface } from "./video_encoder_interface.js"

export class Video {
  #ffmpegWrapper

  /** @type { string | null } #dir current working directory */
  #dir

  /** @type { number } #segmentSeconds float >= 0.0 */
  #segmentSeconds

  /** @type { number } #segmentsWritten an integer >= 0 */
  #segmentsWritten

  /** @type { string } #logLevel ffmpeg -loglevel param */
  #logLevel

  /** @type { Promise<Metadata> } #videoMeta */
  #videoMeta

  /** @type { (Metadata) => void } #videoMeta */
  #videoMetaResolve

  /**   @type {"st" | "mt"} #ffmpegVariant which ffmpeg-core variant to load () */
  #ffmpegVariant = "st"

  /**
   * @param {"st" | "mt"} ffmpegVariant which ffmpeg-core variant to load ()
   */
  constructor(ffmpegVariant) {
    this.#segmentSeconds = 2.0
    this.#ffmpegVariant = ffmpegVariant
    this.#ffmpegWrapper = new FFmpegWrapper(ffmpegVariant)
    this.#reset()
  }

  async #reset() {
    if (this.#dir) await this.#ffmpegWrapper.delete_r(this.#dir)
    this.#segmentsWritten = 0
    this.#dir = null
    this.#logLevel = "verbose"
    this.#videoMeta = new Promise((resolve, _reject) => this.#videoMetaResolve = resolve)
  }

  async abort() {
    this.#ffmpegWrapper.terminate()
    this.#ffmpegWrapper = new FFmpegWrapper(this.#ffmpegVariant)
    this.#reset()
  }

  /**
   * blocks until ffmpeg has loaded. It's not necessary to call this, but
   * helpful for UI status.
   */
  async loaded() {
    await this.#ffmpegWrapper.loaded()
  }

  /**
   * @returns {number}
   */
  get segmentSeconds() {
    return this.#segmentSeconds
  }

  /**
   * @param {number} seconds float determining how long each batch/segment will be
   */
  set segmentSeconds(seconds) {
    this.#segmentSeconds = seconds
  }

  /**
   * loadVideoURL takes a URL to download the file from. It returns the filename
   * and filesize.
   * @param {string} url relative or absolute URL
   * @returns {Promise<[filename: string, filesize: number]>}
   */
  async loadVideoURL(url) {
    await this.#reset()
    this.#dir = this.#filenameFromURL(url)

    const fetcher = fetchFile(url)
    await this.#ffmpegWrapper.createDir(this.#dir)

    const data = await fetcher
    const length = data.length

    await this.#ffmpegWrapper.write(this.#input(), data)

    return [this.#dir, length]
  }


  /**
   * loadVideoFile takes a filename and an ArrayBuffer to save
   * @param {string} name filename
   * @param {ArrayBuffer} buffer blob
   */
  async loadVideoFile(name, buffer) {
    await this.#reset()

    this.#dir = name
    await this.#ffmpegWrapper.createDir(this.#dir)

    await this.#ffmpegWrapper.write(this.#input(), new Uint8Array(buffer))
  }

  /**
   * extractVideoFrames extracts frames from the loaded video in batches, but
   * yields one frame at a time. Each yielded frame contains additional metadata
   * that is static for the whole video or batch. This is mostly for
   * convenience. Example of yielded frame:
   *   {
   *     "index": 12, // absolute frame number (i.e. independent of batch)
   *     "image": <ImageBitmap object with the actual pixel data>,
   *     "meta": {
   *       "batch": 0,
   *       "width": 2704,
   *       "height": 1520,
   *       "pix_fmt": "yuvj420p",
   *       "fpsRatio": "30000/1001",
   *       "fps": 29.97002997002997,
   *       "duration": 0.058 // total video duration in seconds
   *     }
   *   }
   * The function assumes that the video file specified in `name` is already
   * present on the given ffmpeg's file system.
   *
   * @param {Progress | null} pbar Progress bar to report segment extractions
   */
  async *extractVideoFrames(pbar = null) {
    let yielded = false
    for await (const frame of this.#extractVideoFramesWebCodecs(pbar)) {
      yielded = true
      yield frame
    }

    if (yielded) return

    for await (const frame of this.#extractVideoFramesFFmpeg(pbar)) {
      yield frame
    }
  }

  /** @param {Progress | null} pbar Progress bar to report segment extractions */
  async * #extractVideoFramesWebCodecs(pbar) {
    if (!('VideoDecoder' in window)) {
      console.debug("WebCodecs video decoding not supported")
      return false
    }

    const data = await this.#ffmpegWrapper.read(this.#input())

    // @ts-ignore imported directly via HTML tag
    const mp4 = MP4Box.createFile();
    const mp4Info = new Promise(async (resolve, reject) => {
      mp4.onReady = (info) => resolve(info)
      mp4.onError = (err) => reject(err)
    }).catch(error => {
      console.log("MP4Box handling failed: ", error)
      return null
    });

    // @ts-ignore weird MP4Box API
    data.buffer.fileStart = 0
    mp4.appendBuffer(data.buffer)

    // this is private API of MP4Box, but unfortunately it neither sends an
    // error nor ready when being given invalid data. To avoid blocking
    // indefinitely, we use the fact that `appendBuffer` parses synchronously
    // and this bool should be true.
    if (!mp4.moovStartFound) {
      console.log("doesn't look like a valid MP4")
      return null
    }

    console.log("waiting for mp4 info")
    const info = await mp4Info
    if (!info) return false
    const track = info.videoTracks[0]

    const description = this.#getMP4BoxTrackDescription(mp4.getTrackById(track.id));
    const config = {
      codec: track.codec,
      codedWidth: track.track_width,
      codedHeight: track.track_height,
      description: description,
    };

    const { supported } = await VideoDecoder.isConfigSupported(config);
    if (!supported) {
      console.log("WebCodecs cannot decode a video with", config)
      return false
    }

    const duration = track.duration / track.timescale
    const fps = track.nb_samples / duration
    const meta = new Metadata({
      width: track.track_width,
      height: track.track_height,
      // TODO: determine value or make optional?
      pixFmt: "yuv420p",
      fpsRatio: `${fps}`,
      fps: fps,
      duration: duration
    })
    this.#videoMetaResolve(meta)

    /** @type Array<Promise<ImageBitmap>> */
    let bitmaps = []
    let decoderFailed = false
    const decoder = new VideoDecoder({
      output(frame) {
        bitmaps.push(
          createImageBitmap(frame).then((bmp) => {
            frame.close()
            return bmp
          })
        )
      },
      error: (e) => {
        console.warn("webcodecs video decoder failed:", e)
        decoderFailed = true
      }
    })

    decoder.configure(config)

    let sampleIdx = 0
    /** @type Promise | true | false */
    let decoderFinished = false
    mp4.onSamples = (id, _user, samples) => {
      console.debug(`sending #samples=${samples.length} to video decoder`)
      for (const sample of samples) {
        decoder.decode(new EncodedVideoChunk({
          type: sample.is_sync ? "key" : "delta",
          timestamp: 1e6 * sample.cts / sample.timescale,
          duration: 1e6 * sample.duration / sample.timescale,
          data: sample.data,
          // @ts-ignore "transfer" exists according to MDN
          transfer: [sample.data.buffer]
        }))
        // if (progressCallback) progressCallback((sampleIdx % samplesPerBatch) / samplesPerBatch)
        sampleIdx++
      }
      mp4.releaseUsedSamples(id, sampleIdx);
      if (sampleIdx === track.nb_samples) decoderFinished = decoder.flush()
    }

    mp4.setExtractionOptions(track.id, "user pass thru value", { nbSamples: 100 });
    // mp4.setExtractionOptions(track.id, "user pass thru value", { nbSamples: samplesPerBatch });
    mp4.start()
    mp4.flush()

    let index = 0
    const framesPerBatch = Math.round(this.#segmentSeconds * fps)
    while (true) {
      const bitmap = bitmaps.shift()
      if (bitmap) {
        const batch = Math.floor(index / framesPerBatch)
        const metaWithBatch = { "batch": batch, ...meta }
        yield { "index": index, "image": await bitmap, "meta": metaWithBatch }
        index++
        if (pbar) pbar.min(0).cur(index % framesPerBatch).max(framesPerBatch).describe("extracting segment")
        continue
      }

      if (decoderFailed) {
        console.warn("webcodec decoding: VideoDecoder failed, aborting")
        break
      }

      if (decoderFinished === true) {
        console.debug("webcodec decoding: decoder was flushed and has no more frames, video must be complete")
        break
      }

      if (decoderFinished) {
        console.debug("webcodec decoding: last iteration had no frames, but mp4box extraction is complete. Waiting for decoder flush.")
        await decoderFinished
        console.debug("webcodec decoding: decoder finished")
        decoderFinished = true
        continue
      }

      console.debug(`webcodec decoding: mp4box has not provided samples yet, sleeping 500ms. Waiting for index=${index} of max=${track.nb_samples}`)
      await this.#sleep(500)
    }

    decoder.close()
  }

  #sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // voodoo provided by ChatGPT to grab the h264/h265 init segment?
  #getMP4BoxTrackDescription(trak) {
    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
      const box = entry.avcC || entry.hvcC
      if (!box) continue
      // @ts-ignore DataStream imported directly via HTML tag of MP4Box
      const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN)
      box.write(stream)
      // Remove the box header.
      return new Uint8Array(stream.buffer, 8)
    }
    throw "avcC or hvcC not found";
  }

  /** @param {Progress | null} pbar Progress bar to report segment extractions */
  async * #extractVideoFramesFFmpeg(pbar) {
    let frameIndex = 0
    await this.#readMetadataFromLogs()

    for (let timeInS = 0, batch = 0; true; timeInS += this.#segmentSeconds, batch++) {
      console.debug(`extracting frames for batch=${batch} from=${timeInS} to=${timeInS + this.#segmentSeconds}`)
      const rawFrames = await this.#segmentToRawFrames(timeInS, this.#segmentSeconds, pbar)

      // i.e. finished reading video
      if (!rawFrames) {
        console.debug(`extracting frames completed -- video has ended`)
        return
      }

      if (batch === 0) console.debug("ffmpeg awaiting video metadata")
      const meta = { "batch": batch, ...await this.#videoMeta }
      if (batch === 0) console.debug("ffmpeg video metadata:", meta)
      const frameBytes = meta.width * meta.height * 4
      if (rawFrames.length % frameBytes !== 0) {
        throw new Error(`extracted video frames should be multiple of w*h*bpp=${frameBytes}, but frames bytes=${rawFrames.length}`)
      }

      for (let pos = 0; pos < rawFrames.length; pos += frameBytes) {
        console.debug("ffmpeg extracting frame", frameIndex, "from batch=", batch, "pos=", pos)
        const imgData = new ImageData(rawFrames.subarray(pos, pos + frameBytes), meta.width, meta.height)
        const bitmap = await createImageBitmap(imgData)
        yield { "index": frameIndex, "image": bitmap, "meta": meta }
        frameIndex++
      }
    }
  }

  async newEncoder(pbar) {
    console.debug("video: creating new encoder")
    const videoMeta = await this.#videoMeta
    const keyFrameInterval = Math.round(this.#segmentSeconds * videoMeta.fps)

    /** @type {[FFmpegWrapper, string, Metadata, Number, Progress]} args */
    const args = [this.#ffmpegWrapper, this.#path("encode"), videoMeta, keyFrameInterval, pbar]

    console.debug("video: trying WebCodecs encoder")
    /** @type {EncoderInterface} encoder */
    let encoder = new VideoEncoderWebCodecs(...args)
    if (!(await encoder.isSupported())) {
      console.debug("video: trying FFmpeg encoder")
      encoder = new VideoEncoderFFmpeg(...args)
    }

    return encoder
  }

  /**
   * render takes a list of segments (or a compatible video anyway) and
   * concatenates them into a single file. Additionally, it takes audio and
   * supported metadata from the currently loaded video. It returns the rendered
   * video als blob.
   * @param {Array<string>} segments
   * @param {Progress | null} pbar
   * @returns {Promise<Blob>}
   */
  async render(segments, pbar) {
    const output = this.#path("output.mp4")
    pbar?.describe("combining segments + audio")
    await this.#ffmpegWrapper.exec([
      "-i", `concat:${segments.join("|")}`,
      "-i", this.#input(),
      '-map', 0,
      // TODO: needed? read from source?
      // '-color_primaries', 'bt709',
      // '-color_trc', 'bt709',
      // '-colorspace', 'bt709',
      // hardcoded for highest compatibility
      // "-pix_fmt", meta.pixFmt,
      "-pix_fmt", "yuv420p",
      '-c', 'copy',
      // '-preset:0', 'fast',
      // i.e. take stuff from original video file
      '-map', 1,
      '-map_metadata', 1,
      '-map', '-1:v', // except the video
      '-map', '-1:d', // and data streams that ffmpeg usually struggles with
      '-movflags', '+faststart',
      output
    ], pbar)

    const data = await this.#ffmpegWrapper.read(output)
    this.#ffmpegWrapper.delete(output)

    pbar?.finish().hide()

    return new Blob([data.buffer], { type: 'video/mp4' })
  }

  /**
   *
   * @param {number} fromInSeconds
   * @param {number} durationInSeconds
   * @param {Progress | null} pbar
   * @returns Promise<Uint8ClampedArray | null>
   */
  async #segmentToRawFrames(fromInSeconds, durationInSeconds, pbar) {
    let origCur
    if (pbar) {
      pbar.reset().min(0).cur(0).max(1).describe("extracting segment")

      const meta = await Promise.race([this.#videoMeta, Promise.resolve(null)])
      if (meta) {
        origCur = pbar.cur.bind(pbar)
        // ffmpeg.wasm calculates percentage on whole video length, ignoring the
        // `-t` parameter. Let's fix that.
        pbar.cur = (val) => {
          const corrected = val == 1.0 ? 1.0 : val / durationInSeconds * meta.duration
          return origCur(corrected)
        }
      }
    }

    const tmpFile = this.#path(`frame-extract-${fromInSeconds}-${durationInSeconds}.rawvideo`)
    await this.#ffmpegWrapper.exec([
      '-hide_banner',
      '-loglevel', this.#logLevel,
      '-ss', fromInSeconds,
      '-t', durationInSeconds,
      '-i', this.#input(),
      '-pix_fmt', 'bgr32',
      '-vcodec', 'rawvideo',
      '-f', 'image2pipe',
      tmpFile], pbar)

    if (pbar && origCur) pbar.cur = origCur
    if (pbar) pbar.finish().hide()

    const rawData = new Uint8ClampedArray(await this.#ffmpegWrapper.read(tmpFile))
    this.#ffmpegWrapper.delete(tmpFile)

    return rawData.length === 0 ? null : rawData
  }


  /**
   * readMetadataFromLogs listens to the logs (needs: -loglevel verbose) of the next
   * ffmpeg run.
   */
  async #readMetadataFromLogs() {
    const regexDur = /Duration: (\d\d):(\d\d):(\d\d).(\d+)/
    const regexFrame = /w:(\d+) h:(\d+) pixfmt:([^\s]+) tb:[^\s]+ fr:(\d+)\/(\d+)/
    const oldLevel = this.#logLevel
    this.#logLevel = "verbose"

    let duration = 0
    const matcher = ({ message }) => {
      // assumption: ffmpeg prints a matching duration before the other
      // metadata.
      let match = message.match(regexDur)
      if (match) {
        const [_, h, m, s, ms] = match
        const ms_pad = ms.padEnd(3, "0")
        duration = h * 60 * 60 + m * 60 + s * 1 + ms_pad / 1000
      }

      match = message.match(regexFrame)
      if (!match) return
      const [_, w, h, pixFmt, fpsNum, fpsDenom] = match
      this.#videoMetaResolve(new Metadata({
        width: w,
        height: h,
        pixFmt: pixFmt,
        fpsRatio: `${fpsNum}/${fpsDenom}`,
        fps: fpsNum / fpsDenom,
        duration: duration
      }))

      this.#ffmpegWrapper.off("log", matcher)
      this.#logLevel = oldLevel
    }
    await this.#ffmpegWrapper.on("log", matcher)
    console.debug("ffmpeg log metadata reader waiting for suitable logs")
  }


  // generates filenames in the working directory for the currently loaded video
  #path(name) {
    if (!this.#dir) throw new Error("need to load video first")
    return `${this.#dir}/${name || ''}`
  }

  #input() {
    return this.#path("input.mp4")
  }

  #filenameFromURL(url) {
    try {
      const name = new URL(url).pathname.split("/").at(-1)
      return name || "unknown"
    } catch (e) {
      console.warn("failed to get filename from URL:", url)
    }
    return "unknown"
  }
}
