// @ts-check

import { Box } from './box.js'

class OneFile {
  /** @type {Map<string, Array<Box>} */
  #d

  /** @type {() => void} */
  #saver

  constructor(data, saver) {
    this.#d = data ? new Map(data) : new Map()
    this.#saver = saver
  }

  size() { return this.#d.size }

  /**
   * @param {number} frameIndex
   * @param {Array<Box>} boxes
   * @returns {Array<Box>}
   */
  set(frameIndex, boxes) {
    this.#d.set(`${frameIndex}`, boxes)
    this.#saver()
    return boxes
  }

  purge() {
    this.#d = new Map()
    this.#saver()
  }

  /**
   * @param {number} frameIndex
   * @returns {Array<Box> | null}
   */
  get(frameIndex) {
    return this.#d.get(`${frameIndex}`) || null
  }

  /**
   * @param {number} frameIndex
   * @param {() => Array<Box> | Promise<Array<Box>>} compute
   * @returns {Promise<Array<Box>>}
   */
  async getOrCompute(frameIndex, compute) {
    return this.get(frameIndex) || this.set(frameIndex, await compute())
  }

  toJSON() {
    return Object.fromEntries(this.#d)
  }
}

export class DetectionCache {
  /** @type {Map<string, OneFile | object>} #cache */
  #cache

  /** @type {string} #localStorageKey */
  #localStorageKey

  constructor(localStorageKey) {
    this.#localStorageKey = localStorageKey
    const stored = localStorage.getItem(this.#localStorageKey)

    try {
      if (stored) this.#cache = new Map(Object.entries(JSON.parse(stored)))
    } catch (_e) { }

    this.#cache ||= new Map()
  }

  /**
   * @param {string} filename
   * @param {number} filesize in bytes
   * @param {string} modelName
   * @returns {OneFile}
   */
  for(filename, filesize, modelName) {
    const key = `${filename}-${filesize}-${modelName}`
    let entry = this.#cache.get(key)
    const isObj = typeof entry === 'object'

    if (isObj && entry.constructor.name === 'OneFile') {
      return entry
    }

    const saver = () => this.#save()
    const data = isObj ? Object.entries(entry) : null
    entry = new OneFile(data, saver)

    this.#cache.set(key, entry)
    return entry
  }

  #save() {
    let obj = {};
    for (const [key, entry] of this.#cache) {
      obj[key] = (typeof entry.toJSON === 'function') ? entry.toJSON() : entry
    }

    localStorage.setItem(this.#localStorageKey, JSON.stringify(obj))
  }
}
