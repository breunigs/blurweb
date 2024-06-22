/**
 * @interface
 */
export class EncoderInterface { }

/** add additional frame to encode
 * @function
 * @name EncoderInterface#encode
 * @param {Uint8Array | Uint8ClampedArray} blob
 * @returns {Promise<void>} Resolves once frame has been encoded
 */
EncoderInterface.prototype.encode = (blob) => {
  throw new Error('not implemented')
}

/** finish video encoding and write all segments to ffmpeg
 * @function
 * @name EncoderInterface#flush
 * @returns {Promise<Array<string>>} ordered list of file paths of the video segments
 */
EncoderInterface.prototype.flush = () => {
  throw new Error('not implemented')
}

/** remove allocated resources (files in ffmpeg and objects in memory)
 * @function
 * @name EncoderInterface#destroy
 * @returns {Promise<void>} resolves once cleanup has completed
 */
EncoderInterface.prototype.destroy = () => {
  throw new Error('not implemented')
}


/** check if this encoder can be used for the given settings
 * @function
 * @name EncoderInterface#isSupported
 * @returns {Promise<boolean>}
 */
EncoderInterface.prototype.isSupported = () => {
  throw new Error('not implemented')
}
