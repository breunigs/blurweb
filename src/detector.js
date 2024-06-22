// @ts-check

import { Box } from "./box.js"
import { Model } from "./model.js"

export class Detector {
  /** @type {Worker} #worker */
  #worker


  #reason = "initial detector error reason"
  #terminated = false

  /**
   * blur destructively blurs the specified box on the canvas
   * @param {Model} modelSpecification
   * @param {Array<string>} executionProviders
   * @param {boolean} useMultiThreading
   * @param {Uint8Array} onnxFile
   */
  constructor(modelSpecification, executionProviders, useMultiThreading, onnxFile) {
    this.#worker = new Worker("detector_worker.js", { type: "module" })
    window.addEventListener("beforeunload", () => this.#worker.terminate())

    this.#worker.addEventListener("error", (err) => {
      this.abort(`detector worker failed: ${err}`)
    })

    this.#runInWorker("create", [modelSpecification, executionProviders, useMultiThreading, onnxFile], [onnxFile.buffer]);
  }

  /**
   * Blocks until initialization has finished and throws if it failed
   * @returns {Promise} error message if initialization failed
   */
  loaded() {
    return new Promise(async (resolve, reject) => {
      const error = await this.#runInWorker("loaded")
      error ? reject(error) : resolve(true)
    })
  }

  abort(reason = "user abort") {
    this.#reason = reason
    this.#terminated = true
    this.#runInWorker("destroy").finally(() => this.#worker.terminate())
  }

  /**
   * Detect will run interference on the canvas and return a list of boxes with
   * dimensions matching the input canvas that represent likely results. The
   * returned confidence is for that particular class, and not the overall one.
   * @param {ImageBitmap} image
   * @returns {Promise<{results: Array<Box>, image: ImageBitmap}>}
   */
  detect(image) {
    return this.#runInWorker("detect", [image], [image])
  }

  #runInWorker(task, args = [], transfer = []) {
    if (this.#terminated) {
      const err = new DOMException(this.#reason || "no reason given", "AbortError")
      return new Promise((_resolve, reject) => reject(err))
    }

    return new Promise((resolve, reject) => {
      const channel = new MessageChannel()

      channel.port1.onmessage = ({ data }) => {
        console.log("received data length=", data?.length, "for task", task, "from worker")
        channel.port1.close()
        resolve(data)
      };

      console.debug("detector sending task", task, "to worker")
      this.#worker.postMessage({ task, args }, [channel.port2, ...transfer]);
      console.debug("detector sent task", task, "to worker")
    });
  }
}
