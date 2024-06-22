// @ts-check

import { Box } from "./box.js";
import { Model } from "./model.js";

/**
 * Draws the detected boxes onto the given canvas. It is assumed that the canvas
 * has the size of the original input video frame, i.e. no resizing is being
 * done.
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} canvasContext
 * @param {Model} model
 * @param {Array<Box>} boxes
 */
export function drawDetectionBoxes(canvasContext, { labels }, boxes) {
  const ctx = canvasContext

  const fontSize = Math.round(14 * window.devicePixelRatio)
  ctx.font = `${fontSize}px Arial`;
  ctx.textBaseline = "top";

  ctx.strokeStyle = 'rgba(255,56,56,0.8)';
  ctx.lineWidth = Math.round(2 * window.devicePixelRatio)

  boxes.forEach((box) => {
    const klass = labels[box.labelIndex];
    const score = (box.confidence * 100).toFixed(1);
    const [x, y, width, height] = box.xywh;
    const desc = klass + " " + score

    // draw box border
    ctx.strokeRect(x, y, width, height);

    // draw label background
    ctx.fillStyle = 'rgba(255,56,56,0.8)';
    const textWidth = ctx.measureText(desc).width;
    const yText = y - (fontSize + ctx.lineWidth);
    ctx.fillRect(
      x - 1,
      yText < 0 ? 0 : yText,
      textWidth + ctx.lineWidth,
      fontSize + ctx.lineWidth
    );

    // draw label text
    ctx.fillStyle = "#ffffff";
    ctx.fillText(desc, x - 1, yText < 0 ? 1 : yText + 1);
  });
}

/**
 * @param {number|null} bytes
 * @param {number} dp
 * @returns {string|null}
 */
export function bytes2human(bytes, dp = 1) {
  if (!bytes) return null

  if (Math.abs(bytes) < 1024) {
    return bytes + '&nbsp;B';
  }

  const units = ['KiB', 'MiB', 'GiB'];
  let u = -1;
  const r = 10 ** dp;

  do {
    bytes /= 1024;
    ++u;
  } while (Math.round(Math.abs(bytes) * r) / r >= 1024 && u < units.length - 1);

  return bytes.toFixed(dp) + '&nbsp;' + units[u];
}

export function milliseconds2human(totalMilliseconds) {
  totalMilliseconds = Math.round(totalMilliseconds)
  const totalS = Math.floor(totalMilliseconds / 1000)
  const totalM = Math.floor(totalS / 60)
  const totalH = Math.floor(totalM / 60)
  const totalD = Math.floor(totalH / 24)

  const milliseconds = totalMilliseconds % 1000
  const seconds = totalS % 60
  const minutes = totalM % 60
  const hours = totalH % 24

  let txt = ''

  if (totalD > 0) txt += `${totalD}d `
  if (totalH > 0) txt += `${String(hours).padStart(2, " ")}h `
  if (totalM > 0) txt += `${String(minutes).padStart(2, " ")}m `
  if (totalS > 0) txt += `${String(seconds).padStart(2, " ")}s `
  txt += `${String(milliseconds).padStart(3, " ")}ms`

  return txt
}

/**
* @param {Array} array
* @returns {Array}
*/
export function compact(array) {
  return array.filter(function (element) {
    return element !== null;
  });
}

/**
* @param {string} string
* @returns {string}
*/
export function indent(string) {
  const lines = string.split("\n")
  for (let i = 0; i < lines.length; i++) {
    // @ts-ignore our regex will always match, an empty string if need be
    const indent = lines[i].match(/^\s*/)[0].length
    lines[i] = `<div class="line" style="margin-left: ${indent + 2}ch">${lines[i]}</div>`
  }
  return lines.join("\n")
}

/**
 * Generate a HTML link that scrolls to the given ID, possibly expanding the containing <details> section
 * @param {string} id
 * @param {string} text
 * @returns {string}
 */
export function linkToId(id, text) {
  return `<a href="#${id}" onclick="let d=document.querySelector('details:has(#${id})');if(d) d.open=true; document.getElementById('${id}').scrollIntoView({behavior:'smooth'}); return false">${text}</a>`
}

/**
 *
 * @param {string} url
 * @param {number} parts how many parts the file is split up into. For parts >=
 * 1, will download them from url + ".0" and so on. Assumes all parts will be
 * equally(ish) sized for progress reporting.
 * @param {(current: number, max: number) => any} progressCallback Callback is
 * called periodically. `max` may be 0 if content length unknown. `max` might
 * become 0.
 * @param {AbortController} abort
 * @param {boolean} enableCache
 * @returns {Promise<Uint8Array>}
 */
export async function downloadParts(url, parts, progressCallback, abort = new AbortController(), enableCache = true) {
  if (parts <= 0) return download(url, progressCallback, abort, enableCache)

  let mergedMax = 0
  let mergedBlob = new Uint8Array(0)

  const progressCb = (cur, max) => {
    if (mergedMax === 0) mergedMax = max
    progressCallback(mergedBlob.length + cur, mergedMax * parts)
  }

  for (let part = 0; part < parts; part++) {
    let partBlob = await download(`${url}.${part}`, progressCb, abort, enableCache)
    let tmpBlob = new Uint8Array(mergedBlob.length + partBlob.length)
    tmpBlob.set(mergedBlob, 0)
    tmpBlob.set(partBlob, mergedBlob.length)
    mergedBlob = tmpBlob
  }

  return mergedBlob
}

/**
 *
 * @param {string} url
 * @param {(current: number, max: number) => any} progressCallback Callback is
 * called periodically. `max` may be 0 if content length unknown. `max` might
 * become 0.
 * @param {AbortController} abort
 * @param {boolean} enableCache
 * @returns {Promise<Uint8Array>}
 */
export async function download(url, progressCallback, abort = new AbortController(), enableCache = true) {
  let resp, cached = false
  if (enableCache) {
    const cache = await caches.open('download')
    resp = await cache.match(url)
    if (resp) {
      console.debug("retrieved", url, "from long term cache")
      cached = true
    }
    cached = !!resp
  }
  resp ||= await fetch(url, { signal: abort.signal })

  if (!resp.body) throw new Error(`failed to read URL=${url} due to null body. status=${resp.status}`)

  const contentLength = resp.headers.get('Content-Length');
  let max = contentLength ? Number(contentLength) : 0

  const reader = resp.body.getReader()
  let data = new Uint8Array(max)
  let offset = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      progressCallback(offset, offset)
      if (enableCache && !cached) {
        console.debug("putting", url, "into long term cache")
        caches.open('download').then((cache) => cache.add(url))
      }
      return data
    }

    // server lied about content length
    if (offset + value.length > data.length) max = 0

    if (max === 0) {
      let data2 = new Uint8Array(data.length + value.length)
      data2.set(data, 0)
      data = data2
    }

    data.set(value, offset)
    offset += value.length
    progressCallback(offset, max)
  }
}
