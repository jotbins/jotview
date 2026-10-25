import { deflateRawSync, inflateRawSync } from "node:zlib";

/** Payload prefix. Versions the encoding; must match jotbins' fragmentDoc.ts. */
export const PREFIX = "z:";

/** Mirrors MAX_DOC_BYTES in jotbins' fragmentDoc.ts. Larger docs mint links
 *  the browser refuses to open, so reject at encode time instead. */
export const MAX_DOC_BYTES = 1_000_000;

/** @typedef {"too-large" | "empty" | "not-found" | "usage" | "read-failed" | "bad-link" | "cleaned-up" | "not-allowed"} ErrorCode */

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

const BASE64URL = /^[A-Za-z0-9_-]*$/;

/**
 * Decode a `z:` fragment payload back into markdown.
 * @param {string} payload  the part after `#`
 * @returns {string}
 */
export function decode(payload) {
  if (!payload.startsWith(PREFIX)) {
    throw new JotviewError("bad-link", `not a jotbins doc payload (expected it to start with ${PREFIX})`);
  }
  const body = payload.slice(PREFIX.length);
  // Buffer's base64 decoder silently skips junk, so check the alphabet first.
  if (!BASE64URL.test(body)) throw new JotviewError("bad-link", "the link's document data is corrupted");
  try {
    // Capped so a tiny link can't inflate into gigabytes.
    return inflateRawSync(Buffer.from(body, "base64url"), { maxOutputLength: MAX_DOC_BYTES })
      .toString("utf8");
  } catch (err) {
    if (/** @type {{code?: string}} */ (err).code === "ERR_BUFFER_TOO_LARGE") {
      throw new JotviewError("too-large", `the document is over the ${MAX_DOC_BYTES}-byte limit`);
    }
    throw new JotviewError("bad-link", "the link's document data is corrupted");
  }
}
