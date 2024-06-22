// @ts-check

import { Box } from "./box.js";
import { Model } from "./model.js";

// @ts-ignore
import * as StackBlur from './stackblur.js';

export class Blurrer {
  #cache
  #cacheSize

  constructor(cacheSize) {
    this.#cacheSize = cacheSize
    this.#cache = new Map()
  }

  /**
   * blurBoxes destructively blurs given boxes on the canvas.
   * @param {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} canvasContext
   * @param {Model} model
   * @param {Array<Box>} boxes
   */
  blurBoxes(canvasContext, { roundCornerRatios }, boxes) {
    boxes.forEach((box) => this.blurArea(canvasContext, roundCornerRatios[box.labelIndex], box.xywh))
  }

  /**
   * blurArea destructively blurs the specified box on the canvas. The corner ratio
   * range is from 0.0 (a rectangle) to 1.0 (an ellipse).
   * @param {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} canvasContext
   * @param {number} roundCornerRatio
   * @param {[number, number, number, number]} dimensions
   */
  blurArea(canvasContext, roundCornerRatio, [x, y, w, h]) {
    // larger transition area for larger boxes
    const feather = Math.round(Math.max(3.0, Math.max(w, h) / 12.0))

    // round to integers, but err on the side of enlarging the blur area
    let xi = Math.floor(x - feather * 2)
    let yi = Math.floor(y - feather * 2)
    let wi = Math.ceil(w + (x - xi) + feather * 2)
    let hi = Math.ceil(h + (y - yi) + feather * 2)

    const radius = Math.round(Math.min(w, h) / 2 * roundCornerRatio);
    // if detection is at a border, simply enlarge mask to hide rounded
    // corners
    if (radius > 0) {
      if (xi < 10) { xi -= radius; wi += radius; }
      if (yi < 10) { yi -= radius; hi += radius; }
      if (xi + wi > canvasContext.canvas.width - 10) { wi += radius }
      if (yi + hi > canvasContext.canvas.height - 10) { hi += radius }
    }

    // round up blur areas to the nearest n pixels to improve cache usage
    const blurMaskModulo = 5
    wi = wi + blurMaskModulo - (wi % blurMaskModulo);
    hi = hi + blurMaskModulo - (hi % blurMaskModulo);
    const mask = this.#getMask(wi, hi, radius, feather)

    // increase strength for large areas
    const strength = Math.max(10, Math.min(50, Math.round(wi * hi / 100)))

    const plain = canvasContext.getImageData(xi, yi, wi, hi);
    const blurred = canvasContext.getImageData(xi, yi, wi, hi);
    StackBlur.imageDataRGB(blurred, 0, 0, wi, hi, strength);

    for (let i = 0; i < blurred.data.length; i += 4) {
      const alpha = mask[i / 4]

      blurred.data[i + 0] = blurred.data[i + 0] * alpha + plain.data[i + 0] * (1 - alpha)
      blurred.data[i + 1] = blurred.data[i + 1] * alpha + plain.data[i + 1] * (1 - alpha)
      blurred.data[i + 2] = blurred.data[i + 2] * alpha + plain.data[i + 2] * (1 - alpha)
    }

    canvasContext.putImageData(blurred, xi, yi)
  }

  /**
   * @param {number} width
   * @param {number} height
   * @param {number} radius
   * @param {number} feather
   * @returns {Float32Array}
   */
  #getMask(width, height, radius, feather) {
    const cacheKey = `${width}-${height}-${radius}-${feather}`
    let mask = this.#cache.get(cacheKey)

    if (mask !== undefined) {
      // LRU since maps keep insertion order
      this.#cache.delete(cacheKey)
      this.#cache.set(cacheKey, mask)
      return mask
    }

    mask = this.#createNewMask(width, height, radius, feather)
    this.#cache.set(cacheKey, mask)

    if (this.#cache.size === this.#cacheSize) {
      const oldestKey = this.#cache.keys().next().value
      this.#cache.delete(oldestKey);
    }

    return mask
  }

  /**
   * @param {number} width
   * @param {number} height
   * @param {number} radius
   * @param {number} feather
   * @returns {Float32Array}
   */
  #createNewMask(width, height, radius, feather) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error("failed to create canvas")

    // Draw a rounded rectangle on the canvas
    ctx.beginPath();
    ctx.moveTo(radius + feather, feather);
    ctx.lineTo(width - radius - feather, feather);
    ctx.arc(width - radius - feather, radius + feather, radius, Math.PI * 1.5, Math.PI * 2);
    ctx.lineTo(width - feather, height - radius - feather);
    ctx.arc(width - radius - feather, height - radius - feather, radius, 0, Math.PI * 0.5);
    ctx.lineTo(radius + feather, height - feather);
    ctx.arc(radius + feather, height - radius - feather, radius, Math.PI * 0.5, Math.PI);
    ctx.lineTo(feather, radius + feather);
    ctx.arc(radius + feather, radius + feather, radius, Math.PI, Math.PI * 1.5);
    ctx.closePath();
    ctx.fillStyle = 'white';
    ctx.filter = `blur(${feather / 2}px)`
    ctx.fill();

    const mask = ctx.getImageData(0, 0, width, height);
    const raw = new Float32Array(width * height)
    for (let i = 0; i < raw.length; i++) raw[i] = mask.data[i * 4] / 255

    return raw
  }
}
