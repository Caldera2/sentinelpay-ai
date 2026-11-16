"use strict";
const { Buffer } = require("buffer");
const MAX_BYTES = 4096;
function decode(bytes, littleEndian) {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError("A byte buffer is required.");
  if (bytes.length > MAX_BYTES)
    throw new RangeError("Integer buffer is too large.");
  let result = 0n;
  for (let offset = 0; offset < bytes.length; offset++) {
    const index = littleEndian ? bytes.length - offset - 1 : offset;
    result = (result << 8n) | BigInt(bytes[index]);
  }
  return result;
}
function encode(value, width, littleEndian) {
  if (typeof value !== "bigint") throw new TypeError("A bigint is required.");
  if (!Number.isSafeInteger(width) || width < 0 || width > MAX_BYTES)
    throw new RangeError("Invalid integer buffer width.");
  if (value < 0n || value >= 1n << BigInt(width * 8))
    throw new RangeError("Integer does not fit its unsigned buffer.");
  const result = Buffer.alloc(width);
  let remaining = value;
  for (let offset = 0; offset < width; offset++) {
    result[littleEndian ? offset : width - offset - 1] = Number(
      remaining & 255n,
    );
    remaining >>= 8n;
  }
  return result;
}
exports.toBigIntLE = (bytes) => decode(bytes, true);
exports.toBigIntBE = (bytes) => decode(bytes, false);
exports.toBufferLE = (value, width) => encode(value, width, true);
exports.toBufferBE = (value, width) => encode(value, width, false);
