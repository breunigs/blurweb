// @ts-check

import * as Util from './util.js';

export class Progress {
  /** @type {HTMLProgressElement} el */
  #elP
  /** @type {HTMLSpanElement} text */
  #elT

  /** @type {Number} min */
  #min
  /** @type {Number | null} cur */
  #cur
  /** @type {Number} max */
  #max
  /** @type {boolean} failed */
  #failed = false
  /** @type {String} description */
  #description = ""

  /** @type {"byte" | "millisecond" | "second" | null} max */
  #type

  /** @type {number | null} */
  #raf

  /** @type {String} class */
  #class = ""

  #started
  #finished

  /**
   *
   * @param {string} id
   * @param {Number} min
   * @param {Number | null} cur
   * @param {Number} max
   * @param {"byte" | "millisecond" | "second" | null} type
   */
  constructor(id, min, cur, max, type = null) {
    // @ts-ignore
    this.#elP = document.getElementById(id)
    // @ts-ignore
    this.#elT = document.getElementById(id + "Text")

    this.#min = min
    this.#cur = cur
    this.#max = max

    this.#type = type

    this.#raf = null
    this.#started = window.performance.now()

    this.#render()
  }

  describe(text) {
    this.#description = `${text} `
    return this
  }

  indeterminate() {
    this.#cur = null
    this.#render()
    return this
  }

  inc() {
    this.#cur ||= 0
    this.#cur++
    this.#render()
    return this
  }

  cur(val) {
    this.#cur = val
    this.#render()
    return this
  }

  min(val) {
    this.#min = val
    this.#render()
    return this
  }

  max(val) {
    this.#max = val
    this.#render()
    return this
  }

  inc_max() {
    this.#max ||= 0
    this.#max++
    this.#render()
    return this
  }

  reset() {
    this.#finished = null
    this.#failed = false
    this.#class = ""
    this.#render()
    return this
  }

  failed() {
    this.#finished = window.performance.now()
    this.#cur = 1
    this.#max = 0
    this.#failed = true
    this.#render()
    return this
  }

  finish() {
    this.#finished = window.performance.now()
    if (this.#cur !== null) this.#cur = this.#max
    this.#render()
    return this
  }

  hide() {
    this.#class = "hide"
    this.#render()
  }

  downloadProgress() {
    return (cur, max) => {
      this.#cur = cur
      this.#max = max
      this.#render()
    }
  }

  #render() {
    if (this.#raf) return

    this.#raf = requestAnimationFrame(() => {
      this.#raf = null

      this.#elP.setAttribute("min", String(this.#min))
      this.#elP.setAttribute("max", String(this.#max))
      this.#elP.setAttribute("class", this.#class)

      // i.e. indeterminate, unless we're done – then show 100%
      if (this.#cur === null && !this.#finished) {
        this.#elP.removeAttribute("value")
      } else {
        const val = this.#cur === null ? this.#max : this.#cur
        this.#elP.setAttribute("value", String(val))
      }

      let text = this.#finished || (this.#cur === this.#max && this.#max > 0) ? '✅ ' : '⏳ '
      if (this.#failed) text = `‼️ FAILED ${Util.linkToId("status", "show detailed error")}`
      if (this.#cur === null) {
        const diff = (this.#finished || window.performance.now()) - this.#started
        text += Util.milliseconds2human(diff) + " elapsed"
        if (!this.#finished) setTimeout(() => this.#render(), 500)
      } else if (this.#max > 0) {
        const percent = ((this.#cur - this.#min) / (this.#max - this.#min) * 100).toFixed(1)
        const probablyRatio = this.#min == 0 && this.#max == 1
        const details = probablyRatio ? '' : `(${this.#unit2human(this.#cur)} / ${this.#unit2human(this.#max)})`
        text += `${percent}% ${details}`
      }

      this.#elT.innerHTML = `${this.#description}${text}`
    })

  }

  #unit2human(val) {
    if (this.#type === "byte") return Util.bytes2human(val)
    if (this.#type === "second") return Util.milliseconds2human(val * 1000)
    if (this.#type === "millisecond") return Util.milliseconds2human(val)
    return Number.isInteger(val) ? val : val.toFixed(1)
  }
}
