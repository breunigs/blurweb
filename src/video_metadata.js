// @ts-check

export class Metadata {
  /** @type {number()} width */
  width

  /** @type {number()} height */
  height

  /** @type {string()} pixFmt */
  pixFmt

  /** @type {string()} fpsRatio */
  fpsRatio

  /** @type {number()} fps */
  fps

  /** @type {number()} duration -- total duration in seconds */
  duration

  constructor(plain) {
    this.width = plain.width * 1
    this.height = plain.height * 1
    this.pixFmt = `${plain.pixFmt}`
    this.fpsRatio = plain.fpsRatio
    this.fps = plain.fps * 1
    this.duration = plain.duration * 1
  }
}
