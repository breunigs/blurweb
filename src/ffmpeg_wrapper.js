// @ts-check

// @ts-ignore
import { FFmpeg } from './ffmpeg/index.js'
import { Progress } from './progress.js'

export class FFmpegWrapper {
  #ffmpeg
  #ffmpegVariant
  /** @type {Array<Progress | null>} #progressCallbacks */
  #progressCallbacks = []

  /**
   * @param {"st" | "mt"} ffmpegVariant which ffmpeg-core variant to load ()
   */
  constructor(ffmpegVariant) {
    this.#ffmpegVariant = ffmpegVariant
    this.#ffmpeg = this.#loadFFmpeg()
  }

  async on(event, callback) {
    console.debug(`ffmpeg-wrapper: on(${event}, …)`)
    return (await this.#ffmpeg).on(event, callback)
  }

  async off(event, callback) {
    console.debug(`ffmpeg-wrapper: off(${event}, …)`)
    return (await this.#ffmpeg).off(event, callback)
  }

  /**
   * blocks until ffmpeg has loaded. It's not necessary to call this, but
   * helpful for UI status.
   */
  async loaded() {
    await this.#ffmpeg
  }

  /**
   * @param {string} fullPath
   * @returns {Promise<Uint8Array>}
   */
  async read(fullPath) {
    console.debug("ffmpeg-wrapper: readFile(", fullPath, ")")
    return await (await this.#ffmpeg).readFile(fullPath)
  }

  /**
   * @param {string} directory
   */
  async delete_r(directory) {
    console.debug("ffmpeg-wrapper: listDir(", directory, ")")
    const items = await (await this.#ffmpeg).listDir(directory)
    await Promise.all(items.map(({ isDir: isDir, name: name }) => {
      if (!isDir) this.delete(`${directory}/${name}`)
    }))
    console.debug("ffmpeg-wrapper: deleteDir(", directory, ")")
    await (await this.#ffmpeg).deleteDir(directory)
  }

  /**
   * @param {string} fullPath
   * @param {Uint8ClampedArray | Uint8Array} data
   */
  async write(fullPath, data) {
    console.debug(`ffmpeg-wrapper: writeFile(${fullPath}, [${data.length} bytes])`)
    const ok = await (await this.#ffmpeg).writeFile(fullPath, data)
    if (!ok) throw new Error(`failed writing to path=${fullPath} data-type=${typeof data}`)
  }

  /**
   * @param {string} fullPath
   */
  async delete(fullPath) {
    console.debug(`ffmpeg-wrapper: deleting(${fullPath})`)
    const ok = await (await this.#ffmpeg).deleteFile(fullPath)
    if (!ok) throw new Error(`failed deleting path=${fullPath}`)
  }

  /**
   * @param {string} fullPath
   */
  async createDir(fullPath) {
    console.debug("ffmpeg-wrapper: createDir(", fullPath, ")")
    const ok = await (await this.#ffmpeg).createDir(fullPath)
    if (!ok) throw new Error(`failed creating dir=${fullPath}`)
  }

  /**
 * @param {Array<string|number>} args ffmpeg command line arguments
 * @param {Progress | null} pbar will report ffmpeg's progress on this task.
 * @returns {Promise<number>} exit code as integer
 */
  async exec(args, pbar = null) {
    console.log(`running: ffmpeg '${args.join("' '")}'`)
    for (let i = 0; i < args.length; i++) {
      const type = typeof args[i]
      switch (type) {
        case "number":
          args[i] = args[i].toString()
          break
        case "string":
          break
        default:
          throw new Error(`argument at pos=${i} value=${args[i]} has unsupported type ${type}`)
      }
    }

    this.#progressCallbacks.push(pbar)

    try {
      console.debug("ffmpeg-wrapper: exec(", ...args, ")")
      const code = await (await this.#ffmpeg).exec(args)
      if (code !== 0) throw new Error(`exited with code=${code}`)
      return code
    } catch (e) {
      throw new Error(`exec failed with e=${e}`)
    } finally {
      this.#progressCallbacks.shift()
    }
  }

  terminate() {
    this.#ffmpeg.then((ffmpeg) => ffmpeg.terminate())
  }

  async #loadFFmpeg() {
    const ffmpeg = new FFmpeg();
    ffmpeg.on("log", ({ message }) => {
      if (message.includes("No accelerated colorspace conversion found from")) return
      if (message.includes("deprecated pixel format used, make sure you did set range correctly")) return
      console.debug("ffmpeg-wrapper: ffmpegOUT |", message)
    })
    ffmpeg.on("progress", ({ progress }) => {
      // discard weird values. It should be between 0.0 and 1.0.
      if (progress > 1) {
        console.debug("ffmpeg-wrapper: ignoring weird ffmpeg progress value:", progress);
        return
      } else {
        // console.debug("ffmpeg-wrapper: progress", progress);
      }
      if (this.#progressCallbacks[0]) this.#progressCallbacks[0].min(0).cur(progress).max(1)
    });
    console.debug(`ffmpeg-wrapper: ffmpeg core-${this.#ffmpegVariant} is loading`)
    await ffmpeg.load({ coreURL: `${location.pathname}ffmpeg-core-${this.#ffmpegVariant}/ffmpeg-core.js` });
    console.debug(`ffmpeg-wrapper: ffmpeg core-${this.#ffmpegVariant} has loaded`)
    return ffmpeg
  }
}
