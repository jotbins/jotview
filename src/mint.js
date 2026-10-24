import { encode, JotviewError } from "./codec.js";
import { shorten, DEFAULT_BASE_URL, SHORTEN_THRESHOLD } from "./shorten.js";

/** @typedef {"auto" | "always" | "never"} ShortenMode */

/**
 * @typedef {object} MintResult
 * @property {string} url          what to hand the user — short when shortened
 * @property {string} rawUrl       the full /d link, always
 * @property {boolean} shortened
 * @property {boolean} permanent   only true for a shortened link made with `keep`
 * @property {string|null} failure the shortener's error, when it was tried and failed
 * @property {"custom-base"|"uploads-off"|null} skipped
 *   why a link that would have been shortened was not
 */

/**
 * Turn markdown into a jotbins link, shortening it through surl when the
 * mode and size call for it. Shared by the CLI and the MCP server so both
 * make the same decision; each words the outcome for its own audience.
 *
 * @param {string} md
 * @param {{
 *   baseUrl?: string,
 *   shorten?: ShortenMode,
 *   keep?: boolean,
 *   allowUpload?: boolean,
 *   threshold?: number,
 *   shortenImpl?: typeof shorten,
 * }} [opts]
 * @returns {Promise<MintResult>}
 */
export async function mint(md, opts = {}) {
  const {
    baseUrl = DEFAULT_BASE_URL,
    shorten: mode = "auto",
    keep = false,
    allowUpload = true,
    threshold = SHORTEN_THRESHOLD,
    shortenImpl = shorten,
  } = opts;

  if (md.trim() === "") throw new JotviewError("empty", "input is empty");
  const rawUrl = `${baseUrl}/d#${encode(md)}`;

  /** @type {MintResult} */
  const result = {
    url: rawUrl, rawUrl, shortened: false, permanent: false, failure: null, skipped: null,
  };

  const wanted = mode === "always" || (mode === "auto" && rawUrl.length > threshold);
  if (!wanted) return result;

  // surl's allowlist accepts only jotbins.com hosts, so a custom base URL can
  // never be shortened. Skip rather than fire a request guaranteed to 400.
  if (baseUrl !== DEFAULT_BASE_URL) return { ...result, skipped: "custom-base" };
  if (!allowUpload) return { ...result, skipped: "uploads-off" };

  const outcome = await shortenImpl(rawUrl, { permanent: keep });
  if (!outcome.ok) return { ...result, failure: outcome.reason };
  return { ...result, url: outcome.short, shortened: true, permanent: keep };
}
