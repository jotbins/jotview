import { decode, JotviewError } from "./codec.js";
import { SHORTENER_URL } from "./shorten.js";

const SHORTENER_HOST = new URL(SHORTENER_URL).host;
const DOC_HOSTS = ["jotbins.com", "www.jotbins.com"];
const SHORT_PATH = /^\/[A-Za-z0-9]+$/;

/** Milliseconds before giving up on surl. */
const TIMEOUT_MS = 5000;

// Pinned by surl's own page tests (src/pages.rs): the waiting page links its
// target from #continue; the cleaned-up page has #deleted and #purge.
const CONTINUE_HREF = /id="continue" href="([^"]*)"/;
const DELETED = /id="deleted"/;
const PURGE_TEXT = /id="purge">([^<]*)</;

/** @param {string} s */
const unescapeHtml = (s) =>
  s.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">").replaceAll("&amp;", "&");

const notJotbins = () =>
  new JotviewError("bad-link", `only jotbins.com/d links and ${SHORTENER_HOST} short links can be read`);

/**
 * Decode a jotbins `/d` URL; anything else is a bad link.
 * @param {string} raw
 * @returns {{markdown: string, url: string}}
 */
function decodeDocUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw notJotbins(); }
  if (url.protocol !== "https:" || !DOC_HOSTS.includes(url.host) || url.pathname !== "/d") {
    throw notJotbins();
  }
  return { markdown: decode(url.hash.slice(1)), url: raw };
}

/**
 * Turn a jotbins link back into its markdown. `/d` links decode locally;
 * surl short links are fetched (and, like a click, keep an active link alive).
 * Only surl is ever fetched.
 *
 * @param {string} input
 * @param {{fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<{markdown: string, url: string}>} `url` is the /d link
 */
export async function readLink(input, opts = {}) {
  const raw = input.trim();
  let url;
  try { url = new URL(raw); } catch { throw notJotbins(); }
  if (url.host !== SHORTENER_HOST) return decodeDocUrl(raw);
  if (url.protocol !== "https:" || !SHORT_PATH.test(url.pathname)) throw notJotbins();

  const doFetch = opts.fetchImpl ?? fetch;
  let response;
  try {
    response = await doFetch(`https://${SHORTENER_HOST}${url.pathname}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new JotviewError("read-failed", `couldn't reach ${SHORTENER_HOST}: ${/** @type {Error} */ (err).message}`);
  }

  if (response.status === 404) {
    throw new JotviewError("not-found", "that short link doesn't exist (or was deleted for good)");
  }
  if (response.status >= 300 && response.status < 400) {
    return decodeDocUrl(response.headers.get("location") ?? "");
  }
  if (!response.ok) {
    throw new JotviewError("read-failed", `${SHORTENER_HOST} returned ${response.status}`);
  }

  const html = await response.text();
  const target = html.match(CONTINUE_HREF);
  if (target) return decodeDocUrl(unescapeHtml(target[1]));
  if (DELETED.test(html)) {
    const purge = html.match(PURGE_TEXT)?.[1];
    throw new JotviewError(
      "cleaned-up",
      "that short link was cleaned up after 30 days without a visit" +
        (purge ? ` and is gone for good on ${unescapeHtml(purge)}` : "") +
        ". Open it in a browser and press Save to bring it back.",
    );
  }
  throw new JotviewError("read-failed", `unexpected page from ${SHORTENER_HOST}`);
}
