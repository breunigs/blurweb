// @ts-check

import { Detector } from './detector.js'
import { Video } from './video.js'
import { Blurrer } from './blurrer.js'
import { DetectionCache } from './detection_cache.js'
import { MODELS, Model } from './model.js'
import * as Util from './util.js';
import { Progress } from './progress.js'
import { Box } from './box.js'

export class App {
  /** @type {Video | null} video */
  #video

  /** @type {Blurrer} blurrer */
  #blurrer

  /** @type {Detector | null} detector */
  #detector

  /** @type {DetectionCache} detectionCache */
  #detectionCache

  /** @type {string | null} fileName */
  #fileName

  /** @type {number | null} fileName */
  #fileSize

  /** @type {string | null} fileType */
  #fileType

  /** @type {Model} #model */
  #model

  /** @type {[Error, ...string[]] | null} #lastError */
  #lastError = null

  /** @type {WakeLockSentinel | null} #wakeLock */
  #wakeLock

  #useMultiThreading = false

  #processing = false
  #stopped = false


  constructor(blurrer, detectionCache, useMultiThreading) {
    this.#setupErrorHandling()
    this.#copyConsoleLogs()

    this.#useMultiThreading = useMultiThreading
    this.#blurrer = blurrer
    this.#detectionCache = detectionCache

    this.#get("loadSampleVideo").addEventListener('click', () => this.loadSampleVideo())
    this.#get("loadVideoFile").addEventListener('change', (e) => this.videoFileSelect(e))
    this.#get("start").addEventListener('click', () => this.process())
    this.#get("purgeCache").addEventListener('click', () => this.purgeCache())

    this.#populateModelSelect()
    this.#setupExecProvider()
    this.#acceptDroppedFiles()
    this.#loadModel()
    this.#setupWakeLock()

    document.querySelectorAll("[name=ffmpegOption]").forEach((n) => {
      n.addEventListener('change', () => this.#loadFFmpeg())
    })
    this.#initFFmpegVariant()
    this.#get("segmentSeconds").addEventListener('change', () => this.updateSegmentSeconds())

    setInterval(() => this.#updateStatus(), 1000)

    // TODO: remove debug
    setTimeout(() => this.loadSampleVideo(), 2000)
  }

  #setupErrorHandling() {
    addEventListener("unhandledrejection", (event) => {
      if (event.reason.name === 'AbortError') {
        console.debug("ignoring unhandled AbortError")
        return
      }

      this.#lastError = event.reason.constructor.name == 'Array' ? event.reason : [event.reason]
      console.error("unhandledrejection", event.reason, event, event.promise)
    });

    addEventListener("error", (error) => {
      console.error("unhandlederror", error)
    })
  }

  #previewFrameRecent = false
  async #previewFrame(canvasIn) {
    if (this.#previewFrameRecent) return
    this.#previewFrameRecent = true
    setTimeout(() => this.#previewFrameRecent = false, 1000)

    /** @type {HTMLCanvasElement} canvas */
    // @ts-ignore
    const canvasOut = this.#get("canvas")
    canvasOut.width = canvasIn.width
    canvasOut.height = canvasIn.height
    const ctx = canvasOut.getContext('2d');
    if (!ctx) {
      console.warn("failed to get context for preview canvas")
      return
    }
    ctx.drawImage(canvasIn, 0, 0)
    canvasOut.style.display = 'block'
  }

  #previewVideo(blobURL) {
    const video = this.#get("video")
    video.setAttribute("src", blobURL);
    requestAnimationFrame(() => {
      video.style.display = 'block'
      this.#get("canvas").style.display = 'none'
    })
  }

  #setDownload(blobURL, size) {
    const btn = this.#get("downloadButton")
    btn.setAttribute("download", `${this.#fileName}-blurred.mp4`)
    btn.setAttribute("href", blobURL)
    btn.querySelector("button")?.removeAttribute("disabled")

    const txt = this.#get("downloadButtonText")
    txt.innerHTML = `(${Util.bytes2human(size) || "unknown size"})`
  }

  #removeDownload() {
    const btn = this.#get("downloadButton")
    btn.removeAttribute("download")
    btn.removeAttribute("href")
    btn.querySelector("button")?.setAttribute("disabled", "")

    const txt = this.#get("downloadButtonText")
    txt.innerHTML = ''
  }

  purgeCache() {
    if (!this.#fileName || !this.#fileSize) return this.#error("load video first")
    if (!this.#model) return this.#error("load model first")
    if (!confirm(`Re-run model '${this.#model.description}' for file '${this.#fileName}'?`)) return
    this.#cache()?.purge()
  }

  async process() {
    if (!this.#fileName || !this.#fileSize) return this.#error("load video first")
    if (!this.#detector) return this.#error("load model first")
    this.#stopped = false
    this.#processing = true
    this.#wakeLockOn()

    this.#get("video").style.display = 'none'
    this.#removeDownload()

    // @ts-ignore
    const drawBlursPerson = this.#get("drawBlursPerson").checked
    // @ts-ignore
    const drawBlursPlate = this.#get("drawBlursPlate").checked
    // @ts-ignore
    const drawBoxes = this.#get("drawBoxes").checked

    const isImage = this.#fileType?.startsWith("image/")

    const pbar = new Progress("process", 0, null, 0, "second")
    const subPbar = () => new Progress("subProcess", 0, 0, 0, null)

    if (!this.#video) return this.#error("load ffmpeg first")
    const enc = this.#video.newEncoder(subPbar())

    console.debug("app: start extracting frames")
    for await (const frame of this.#video.extractVideoFrames(subPbar())) {
      if (this.#stopped) return
      // @ts-ignore cache can only be null if it's removed while we're
      // computing
      const boxes = this.#cache().getOrCompute(
        frame.index,
        () => this.#detectFrame(frame)
      )
      const blurred = await boxes
        .then((boxes) => this.#drawOnFrame(frame, boxes, drawBlursPerson, drawBlursPlate, drawBoxes))
        .then(([blurred, canvas]) => {
          this.#previewFrame(canvas)
          frame.image.close()
          return blurred
        })
      await new Promise(resolve => setTimeout(resolve, 0))
      if (!isImage) await (await enc).encode(blurred)
      await new Promise(resolve => setTimeout(resolve, 0))

      const cur = (frame.index + 1) / frame.meta.fps
      const max = frame.meta.duration
      // avoid showing a complete progress bar for the last frame due to the post processing
      if (cur < max) pbar.cur(cur).max(max)
    }

    const segmentPaths = await (await enc).flush()
    console.log("all video encoding segments flushed")
    pbar.indeterminate()

    await new Promise(resolve => setTimeout(resolve, 0))

    if (!isImage) {
      console.log("app: combining final video")
      const data = await this.#video.render(segmentPaths, subPbar())
      enc.then((enc) => enc.destroy())
      const url = URL.createObjectURL(data)

      this.#previewVideo(url)
      this.#setDownload(url, data.size)
    }

    pbar.finish()
    this.#processing = false
    this.#wakeLockOff()
  }

  async #detectFrame(frame) {
    console.debug(`app: frame ${frame.index}: detecting`)
    if (!this.#detector) throw "detector not yet setup"

    console.debug(`frame ${frame.index}: detecting`)
    // only lend the image to the worker
    const { results, image } = await this.#detector.detect(frame.image)
    frame.image = image
    console.debug(`frame ${frame.index}: done detecting`)

    return results
  }

  /**
   *
   * @param {*} frame
   * @param {Array<Box>} boxes
   * @param {boolean} drawBlursPerson
   * @param {boolean} drawBlursPlate
   * @param {boolean} drawBoxes
   * @returns {[Uint8ClampedArray, OffscreenCanvas]}
   */
  #drawOnFrame(frame, boxes, drawBlursPerson, drawBlursPlate, drawBoxes) {
    // console.debug(`app: frame ${frame.index}: drawing`)

    const canvas = new OffscreenCanvas(frame.image.width, frame.image.height)
    const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!ctx) throw new Error("failed to get drawing context for frame")
    ctx.drawImage(frame.image, 0, 0)

    const boxesToBlur = boxes.filter((box) => {
      const klass = this.#model.labels[box.labelIndex];
      return (klass == 'person' && drawBlursPerson) || (klass == 'plate' && drawBlursPlate)
    })

    if (boxesToBlur.length > 0) this.#blurrer.blurBoxes(ctx, this.#model, boxesToBlur)
    if (drawBoxes) Util.drawDetectionBoxes(ctx, this.#model, boxes)

    const imgData = ctx.getImageData(0, 0, frame.meta.width, frame.meta.height)
    return [imgData.data, canvas]
  }

  #populateModelSelect() {
    let html = ''
    for (let i = 0; i < MODELS.length; i++) {
      const m = MODELS[i]
      html += `<option value=${i} label="${m.description}"></option>`
    }

    this.#get("availableModels").innerHTML = html

    const el = this.#get("modelSelect")
    // @ts-ignore
    el.addEventListener('change', (e) => this.#loadModel())
    el.setAttribute("max", String(MODELS.length - 1))
  }

  #setupExecProvider() {
    this.#get('modelExecProvider').addEventListener("change", (e) => this.#loadModel())
  }

  /** @type {AbortController | null} downloadModelAbort */
  #downloadModelAbort = null

  async #loadModel() {
    const index = this.#get("modelSelect").value * 1
    if (index < 0 || index >= MODELS.length) throw new Error(`Model Index=${index} is out of range`)
    if (this.#downloadModelAbort) {
      console.debug("aborting previous model download")
      this.#downloadModelAbort.abort()
    }
    if (this.#detector) {
      console.debug("aborting previous model detector")
      this.#detector.abort()
    }
    this.#downloadModelAbort = new AbortController()

    this.#model = MODELS[index]
    console.debug("app: downloading detection model", this.#model.name)
    const pbarDl = new Progress("modelDownload", 0, 0, 0, "byte")
    const onnxFile = await Util.downloadParts(
      this.#model.name + ".onnx",
      this.#model.parts,
      pbarDl.downloadProgress(),
      // @ts-ignore we know it's not null
      this.#downloadModelAbort)
    pbarDl.finish()

    // failed to get file or aborted
    if (!onnxFile) return
    this.#downloadModelAbort = null

    console.debug("app: initializing model", this.#model.name)
    const pbarInit = new Progress("modelInit", 0, null, 1)
    const execProviders = this.#getInput("modelExecProvider").value.split(",")

    try {
      this.#detector = new Detector(this.#model, execProviders, this.#useMultiThreading, onnxFile)
      await this.#detector.loaded()
    } catch (e) {
      pbarInit.failed()
      this.#detector = null
      throw e
    }
    pbarInit.finish()
  }

  #initFFmpegVariant() {
    const variant = navigator.userAgent.includes("Firefox/") && this.#useMultiThreading ? "mt" : "st"
    // @ts-ignore
    this.#get(`ffmpeg-${variant}`).checked = true
    this.#loadFFmpeg()
  }

  async #loadFFmpeg() {
    console.debug("loading video processor ffmpeg")
    // @ts-ignore
    const variant = document.querySelector("[name=ffmpegOption]:checked").value || "st"
    const sec = Number(this.#getInput("segmentSeconds").value)

    const hadVideo = this.#unloadVideo()
    this.#video = new Video(variant)
    this.updateSegmentSeconds()

    if (hadVideo) alert("You'll need to pick a video again after switching the video tool")
    await this.#video.loaded()
  }

  updateSegmentSeconds() {
    if (!this.#video) return
    const sec = Number(this.#getInput("segmentSeconds").value)
    this.#video.segmentSeconds = sec
  }

  async loadSampleVideo() {
    this.#unloadVideo()
    if (!this.#video) return this.#error("load ffmpeg first")
    console.debug("loading sample video")
    this.#getInput("loadVideoFile").value = ''

    const pbar = new Progress("fileLoader", 0, 0, 0, "byte").describe("loading sample")
    const filename = "sample_video.mp4"

    // @ts-ignore
    const video = await Util.download(`${location.href}${filename}`, pbar.downloadProgress())
    pbar.indeterminate()

    // @ts-ignore
    await this.#video.loadVideoFile(filename, video)
    this.#fileName = filename
    this.#fileSize = video.length
    this.#fileType = "video/mp4"
    pbar.finish()
  }

  videoFileSelect(event) {
    if (!event) return
    const file = event.target.files[0]
    return this.#loadVideoFile(file)
  }

  #loadVideoFile(file) {
    if (!file) return Promise.reject("no file given")
    this.#unloadVideo()
    const pbar = new Progress("fileLoader", 0, 0, 0, "byte").describe("loading file")
    pbar.indeterminate()

    console.debug("loading video from file")

    this.#fileName = file.name
    this.#fileSize = file.size
    this.#fileType = file.type

    return new Promise((resolve, _reject) => {
      const reader = new FileReader();
      reader.onload = async readerEvent => {
        console.debug("loading video from file <reader onload>")
        pbar.indeterminate()

        if (!readerEvent.target) throw new Error(`failed to read local file ${file.name} (1)`)
        const content = readerEvent.target.result;
        if (!content) throw new Error(`failed to read local file ${file.name} (1)`)
        // @ts-ignore we know it's not a string
        await this.#video.loadVideoFile(file.name, content)
        resolve(undefined)
        pbar.finish()
      }
      reader.onprogress = event => { pbar.cur(event.loaded).max(event.total) }
      reader.readAsArrayBuffer(file)
      pbar.max(file.size)
    })
  }

  #acceptDroppedFiles() {
    document.addEventListener("dragover", (e) => e.preventDefault());

    document.addEventListener("drop", (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length === 0) return

      if (files.length > 1) {
        alert(`You dropped ${files.length} files, but need exactly 1. Will only process the first file.`)
      }

      this.#loadVideoFile(files[0])
      this.#get("loadVideoFile").value = ''
    });
  }

  #unloadVideo() {
    if (!this.#fileName) return false

    // reset progress bar
    new Progress("fileLoader", 0, 0, 0, "byte")
    this.#fileName = null
    this.#fileSize = null

    return true
  }

  async #error(msg) {
    this.#wakeLockOff()
    console.error(msg)
    alert(msg)
    return null
  }

  #cache() {
    if (!this.#fileName || !this.#fileSize) return null
    if (!this.#model) return null
    const key = `${this.#model.name}: ${this.#fileName}`
    return this.#detectionCache.for(key, this.#fileSize, this.#model.name)
  }

  #updateStatus() {
    let text = ""
    text += `selected model: ${this.#model ? this.#model.name : "(none yet)"}<br>`
    text += `loaded file: ${this.#fileName || "(none yet)"}<br>`
    text += `file size: ${Util.bytes2human(this.#fileSize) || "(none yet)"}<br>`
    text += `segment seconds: ${this.#video?.segmentSeconds || "(loading)"}<br>`
    text += `multi-threading: ${this.#useMultiThreading}<br>`

    const cache = this.#cache()
    const cachedFrames = cache?.size() || 0
    this.#get("purgeCache").toggleAttribute("disabled", cachedFrames == 0)
    this.#get("purgeCacheText").innerHTML = `reusing ${cachedFrames} detections from previous runs`

    this.#get("selectedVideoFile").innerHTML = this.#fileName ?
      `${this.#fileName} (${Util.bytes2human(this.#fileSize)})`
      : "(none yet)"

    this.#get("start").toggleAttribute("disabled", (!this.#fileName || !this.#model || !this.#video))
    let missing = []
    if (!this.#fileName) missing.push(Util.linkToId("loadSampleVideo", "select video file"))
    if (!this.#model) missing.push(Util.linkToId("modelSelect", "select detection model"))
    if (!this.#detector) missing.push(Util.linkToId("modelExecProvider", "detector setup"))
    if (!this.#video) missing.push(Util.linkToId("ffmpeg-st", "video tool setup"))
    this.#get("missingStuff").innerHTML = missing.length ? `Still loading/waiting for your input: <ul><li>${missing.join("</li><li>")}</li></ul>` : ''

    if (!this.#processing) {
      let summary = []
      if (this.#model) summary.push(`${this.#model.description} model`)
      if (this.#fileName) summary.push(`${this.#fileName} (${Util.bytes2human(this.#fileSize)})`)
      if (cachedFrames > 0) summary.push(`reusing ${cachedFrames} detections`)
      this.#get("startSummary").innerHTML = `config summary: ${summary.join(", ")}`
    }
    text += `cached video frame detections: ${cache ? cache.size() : 'none'} <br>`

    if (this.#lastError) {
      const [e, ...callers] = this.#lastError

      text += `<br><br>ERROR DETAILS<br>`
      text += `message: ${e.message || e}<br>`
      // @ts-ignore we checked that we have a browser with these fields
      if (e.hasOwnProperty('fileName')) text += `location: ${e.fileName}:${e.lineNumber}:${e.columnNumber}<br>`
      if (callers.length > 0) text += `calltrace:<br>${Util.indent(callers.join("\n"))}<br>`
      // @ts-ignore dunno, TS doesn't pick up ES2021 for JS files
      if (e.stack) text += `stacktrace:<br>${Util.indent(e.stack.replaceAll(location.href, ''))}<br>`
    }

    this.#get("status").innerHTML = text
  }

  /**
   * @param {string} id
   * @returns {HTMLElement}
   */
  #get(id) {
    // @ts-ignore TS is right this might be null, but in a project of this size
    // error handling for this makes no sense
    return document.getElementById(id)
  }

  /**
   * @param {string} id
   * @returns {HTMLInputElement}
   */
  #getInput(id) {
    /** @type {HTMLInputElement | null} el */
    const el = document.querySelector(`input#${id}, select#${id}`)
    if (!el) throw new Error(`app: no input element with id=${id} found`)
    return el
  }

  #setupWakeLock() {
    // re-request wake lock if we lose it during tab change
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return
      if (this.#wakeLock) this.#wakeLockOn()
    });
  }

  async #wakeLockOn() {
    if (!("wakeLock" in navigator)) return

    try {
      this.#wakeLock = await navigator.wakeLock.request("screen")
    } catch (err) {
      this.#wakeLock = null
    }
  }

  #wakeLockOff() {
    if (!this.#wakeLock) return
    this.#wakeLock.release().then(() => this.#wakeLock = null);
  }

  #escapeHTML(string) {
    const pre = document.createElement('pre')
    const text = document.createTextNode(string)
    pre.appendChild(text)
    return pre.innerHTML
  }


  #copyConsoleLogs() {
    const cmds = ["error", "warn", "log", "info", "debug"]
    const original = window.console
    const originals = {}
    const logs = this.#get("logs")
    const url = window.location.origin + window.location.pathname
    let html = ""
    let opened = false
    let raf = null

    for (let cmd of cmds) {
      originals[cmd] = console[cmd]

      console[cmd] = (...args) => {
        const out = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
        const err = new Error()
        // @ts-ignore errors have stacks in all modern browsers
        const stack = err.stack
          .split("\n")
          .map((l) => l.replace(url, ""))
          .map((l) => l.replace(`@${window.location.pathname}`, "@"))
          .map((l) => l.replace(`at console.<computed> [as ${cmd}]`, ""))
        stack.shift()
        stack.shift()

        const source = cmd === "error"
          ? stack.map((l) => this.#escapeHTML(l)).join("<br>")
          : this.#escapeHTML(stack[0])

        html += `<tr><td>${cmd}</td><td>${source}</td><td>${this.#escapeHTML(out)}</td></tr>`
        args.push(stack[0])
        originals[cmd].apply(original, args)

        if (cmd === "error" && !opened) {
          document.querySelector("details:has(#debug)")?.setAttribute("open", "open")
          opened = true
        }

        if (!raf) raf = requestAnimationFrame(() => {
          logs.innerHTML = html
          raf = null
        })
      }
    }
  }

}
