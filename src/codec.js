import { deflateRawSync } from "node:zlib";

/** Payload prefix. Versions the encoding; must match jotbins' fragmentDoc.ts. */
export const PREFIX = "z:";

/** Mirrors MAX_DOC_BYTES in jotbins' fragmentDoc.ts. Larger docs mint links
 *  the browser refuses to open, so reject at encode time instead. */
export const MAX_DOC_BYTES = 1_000_000;

/** @typedef {"too-large" | "empty" | "not-found" | "usage" | "read-failed"} ErrorCode */

export class JotviewError extends Error {
  /** @param {ErrorCode} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "JotviewError";
    this.code = code;
  }
}

/** @param {Buffer} buf */
function toBase64Url(buf) {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/**
 * Encode markdown into a `z:` fragment payload.
 * @param {string} md
 * @returns {string}
 */
export function encode(md) {
  const bytes = Buffer.from(md, "utf8");
  if (bytes.length > MAX_DOC_BYTES) {
    throw new JotviewError(
      "too-large",
      `document is ${bytes.length} bytes; the limit is ${MAX_DOC_BYTES}`,
    );
  }
  // No `level` option: stay on zlib's default so output matches what browsers
  // produce via CompressionStream("deflate-raw").
  return PREFIX + toBase64Url(deflateRawSync(bytes));
}
