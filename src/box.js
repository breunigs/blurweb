// @ts-check

export class Box {
  /** @type {number} labelIndex */
  labelIndex

  /** @type {number} confidence */
  confidence

  /** @type  {[number, number, number, number]} xywh */
  xywh

  /**
   * @param {number} labelIndex an integer referencing the class label
   * @param {number} confidence float from 0.0 to 1.0
   * @param {[number, number, number, number]} dimensions [top, left, width,
   * height] in pixels
   */
  constructor(labelIndex, confidence, [x, y, w, h]) {
    this.labelIndex = labelIndex
    this.confidence = confidence
    this.xywh = [x, y, w, h]
  }

  static sortConfidence({ confidence: p1 }, { confidence: p2 }) {
    return p2 - p1;
  }
}
