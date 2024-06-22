// @ts-check

export class Model {
  /** @type {string} name filename of the onnx model file*/
  name

  /** @type {number} how many file segments the model is split into */
  parts

  /** @type {string} description */
  description

  /** @type {number} width */
  width

  /** @type {number} height */
  height

  /** @type {Array<string>} labels */
  labels

  /** @type {Array<number>} roundCornerRatios */
  roundCornerRatios

  /**
   * Consider two rectangles whose (area of intersection) / (area of union) is
   * larger than this ratio to be "the same". 0 = all boxes are the same, 1 =
   * boxes must match perfectly.
   * @type {Number} thresholdIoU
   */
  thresholdIoU

  /**
   * Consider two rectangles whose (area of intersection) / (area of union) is
   * larger than this ratio to be "the same". 0 = all boxes are the same, 1 =
   * boxes must match perfectly.
   * @type {Number} thresholdConf
   */
  thresholdConf

  /**
   * Same idea as for the overall confidence, but specific confidence for the
   * box to be really of that class.
   * @type {Number} thresholdClass
   */
  thresholdClass

  constructor({ name, parts, description, width, height, labels, roundCornerRatios, thresholdIoU, thresholdConf, thresholdClass }) {
    this.name = name
    this.parts = parts
    this.description = description
    this.width = width
    this.height = height
    this.labels = labels
    this.roundCornerRatios = roundCornerRatios
    this.thresholdIoU = thresholdIoU
    this.thresholdConf = thresholdConf
    this.thresholdClass = thresholdClass
  }
}

const shared = {
  width: 1280,
  height: 736,
  labels: ["plate", "person"],
  roundCornerRatios: [0.95, 0.8],
  thresholdIoU: 0.45,
  thresholdConf: 0.1,
  thresholdClass: 0.1,
}

export const MODELS = [
  new Model({ name: "detect_n_2024_04", parts: 0, description: "XS", ...shared }),
  new Model({ name: "detect_s_2024_04", parts: 0, description: "S", ...shared }),
  new Model({ name: "detect_m_2024_04", parts: 2, description: "M", ...shared }),
  new Model({ name: "detect_l_2024_04", parts: 5, description: "L", ...shared }),
  new Model({ name: "detect_x_2024_04", parts: 9, description: "XL", ...shared })
]

