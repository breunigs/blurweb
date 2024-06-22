// @ts-check

import { Model } from './model.js'
import { Box } from './box.js'

// @ts-ignore
import { env, Tensor, InferenceSession } from './onnx/ort.all.min.js'
env.wasm.wasmPaths = './onnx/'
env.wasm.numThreads = 1
// env.logLevel = 'verbose'
// env.debug = true

export class DetectorWorker {
  #model
  #modelWidth
  #modelHeight
  #thresholdIoU
  #thresholdConf
  #thresholdClass
  #executionProviders

  #bppModel = 3
  #bppCanvas = 4


  /**
   * blur destructively blurs the specified box on the canvas
   * @param {Model} modelSpecification
   * @param {Array<string>} executionProviders
   * @param {boolean} useMultiThreading
   * @param {Uint8Array | null} onnxFile
   */
  constructor({ name, width, height, thresholdIoU, thresholdConf, thresholdClass }, executionProviders, useMultiThreading, onnxFile) {
    env.wasm.numThreads = useMultiThreading ? navigator.hardwareConcurrency : 1

    this.#model = InferenceSession.create(onnxFile || name, { executionProviders: executionProviders })

    this.#modelWidth = width
    this.#modelHeight = height

    this.#thresholdIoU = thresholdIoU
    this.#thresholdConf = thresholdConf
    this.#thresholdClass = thresholdClass

    this.#executionProviders = executionProviders
  }

  /**
   * blocks until ffmpeg has loaded. It's not necessary to call this, but
   * helpful for UI status.
   * @returns {Promise<string | null>} init error message if there was any
   */
  async loaded() {
    let error = null
    await this.#model.catch((e) => {
      error = `Model initialization failed on all providers (${this.#executionProviders.join(", ")}) with error(s) ${e}`
    })
    return error
  }

  #iou({ xywh: [x1, y1, w1, h1] }, { xywh: [x2, y2, w2, h2] }) {
    const ix1 = Math.max(x1, x2)
    const iy1 = Math.max(y1, y2)
    const ix2 = Math.min(x1 + w1, x2 + w2)
    const iy2 = Math.min(y1 + h1, y2 + h2)
    const intersection = (ix2 - ix1) * (iy2 - iy1)

    const area1 = w1 * h1
    const area2 = w2 * h2
    const union = area1 + area2 - intersection

    return intersection / union
  }

  // resize and letterbox to make source image fit into model dimensions
  #imageToTensor(image) {
    const scale = Math.min(this.#modelWidth / image.width, this.#modelHeight / image.height)
    const resizedWidth = Math.round(image.width * scale)
    const resizedHeight = Math.round(image.height * scale)
    const positionLeft = Math.round((this.#modelWidth - resizedWidth) / 2)
    const positionTop = Math.round((this.#modelHeight - resizedHeight) / 2)

    // TODO: can this be reused? Or maybe w/o OffscreenCanvas?
    const modelCanvas = new OffscreenCanvas(this.#modelWidth, this.#modelHeight);
    const ctx = modelCanvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error("failed to create OffscreenCanvas")
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, positionLeft, positionTop, resizedWidth, resizedHeight)
    const imgData = ctx.getImageData(0, 0, this.#modelWidth, this.#modelHeight);

    const float32Data = new Float32Array(this.#bppModel * this.#modelWidth * this.#modelHeight)
    // RGBA RGBA RGBA → RRR GGG BBB
    for (let iColor = 0; iColor < this.#bppModel; iColor++) {
      const colorStart = this.#modelWidth * this.#modelHeight * iColor
      for (let iPixel = 0; iPixel < this.#modelWidth * this.#modelHeight; iPixel++) {
        float32Data[colorStart + iPixel] = imgData.data[iPixel * this.#bppCanvas + iColor] / 255.0;
      }
    }

    const tensor = new Tensor("float32", float32Data, [1, this.#bppModel, this.#modelHeight, this.#modelWidth]);

    return { tensor, scale, positionLeft, positionTop }
  }

  /**
   * only keep the box with the hightest confidence for boxes that are "the
   * same". Sameness is determined by comparing how much two boxes overlap
   * (intersection divided by union) against the `thresholdIuO`.
   * @param {Array<Box>} boxes
   * @returns {Array<Box>}
   */
  #nonMaxSuppression(boxes) {
    const results = []
    boxes.sort(Box.sortConfidence)

    while (boxes.length > 0) {
      results.push(boxes[0])
      boxes = boxes.filter((box) => this.#iou(box, boxes[0]) < this.#thresholdIoU)
    }

    return results;
  }

  /**
   * Detect will run interference on the canvas and return a list of boxes with
   * dimensions matching the input canvas that represent likely results. The
   * returned confidence is for that particular class, and not the overall one.
   * @param {ImageBitmap} image
   * @returns {Promise<Array<Box>>}
   */
  async detect(image) {
    console.debug("detect: convert to tensor")
    const { tensor, scale, positionLeft, positionTop } = this.#imageToTensor(image)
    console.debug("detect: await model")
    const model = (await this.#model)
    console.debug("detect: run inference")
    const { output0 } = await model.run({ images: tensor })
    const [_, resultCount, resultSize] = output0.dims

    console.debug("detect: extract boxes/NMS")
    let boxes = [];
    for (let idx = 0; idx < resultCount; idx++) {
      const candidate = output0.data.slice(idx * resultSize, (idx + 1) * resultSize);
      const [xCenter, yCenter, w, h, confidence, ...classScores] = candidate

      // filter by general confidence
      if (confidence < this.#thresholdConf) continue

      // find most likely class
      let bestClassIdx = 0
      for (let i = 1; i < classScores.length; i++) {
        if (classScores[i] > classScores[bestClassIdx]) bestClassIdx = i
      }
      const bestClassConfidence = classScores[bestClassIdx] * confidence

      // filter by class confidence
      if (bestClassConfidence < this.#thresholdClass) continue

      boxes.push(new Box(
        bestClassIdx,
        bestClassConfidence,
        [
          (xCenter - 0.5 * w - positionLeft) / scale, // left
          (yCenter - 0.5 * h - positionTop) / scale, // top
          w / scale, // width
          h / scale, // height
        ]))
    }

    return this.#nonMaxSuppression(boxes)
  }
}

let instance = null
let taskCounter = 0

onmessage = async (event) => {
  const { task, args } = event.data
  const cnt = taskCounter
  taskCounter++

  console.debug(`detection worker received task ${cnt}:`, task)
  switch (task) {
    case "create":
      instance = new DetectorWorker(args[0], args[1], args[2], args[3])
      console.debug(`detection worker finished task ${cnt}:`, task)
      break

    case "detect":
      const image = args[0]

      const start = performance.now()
      const results = await instance.detect(image)
      const stop = performance.now()

      event.ports[0].postMessage({ results, image }, [image]);
      console.debug(`detection worker answered task ${cnt}:`, task, `(took ${stop - start})`)
      break

    case "loaded":
      const error = await instance.loaded()
      event.ports[0].postMessage(error);
      console.debug(`detection worker answered task ${cnt}:`, task)
      break

    case "destroy":
      if (instance) instance.release()
      event.ports[0].postMessage({});
      instance = null
  }

}
