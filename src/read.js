import { decode, JotviewError } from "./codec.js";
import { SHORTENER_URL } from "./shorten.js";

const SHORTENER_HOST = new URL(SHORTENER_URL).host;
const DOC_HOSTS = ["jotbins.com", "www.jotbins.com"];
const SHORT_PATH = /^\/[A-Za-z0-9]+$/;
const PASTE_PATH = /^\/p\/([A-Za-z0-9_-]+)$/;

/** jotbins.com's production Convex deployment; `/p` pastes live there. */
export const CONVEX_URL = "https://coordinated-canary-492.convex.cloud";

/** Milliseconds before giving up on surl or Convex. */
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
  new JotviewError("bad-link", `only jotbins.com/d and /p links and ${SHORTENER_HOST} short links can be read`);

/**
 * Fetch a saved `/p` paste through the same public query the site uses, so
 * private pastes stay hidden exactly as they do for a signed-out visitor.
 * @param {string} slug
 * @param {string} raw
 * @param {typeof fetch} doFetch
 * @returns {Promise<{markdown: string, url: string}>}
 */
async function readPaste(slug, raw, doFetch) {
  let body;
  try {
    const response = await doFetch(`${CONVEX_URL}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "pastes:getPaste", args: { slug }, format: "json" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    body = await response.json();
  } catch (err) {
    throw new JotviewError("read-failed", `couldn't reach jotbins: ${/** @type {Error} */ (err).message}`);
  }
  if (body?.status !== "success") throw new JotviewError("read-failed", "jotbins couldn't load that paste");
  if (body.value === null) {
    throw new JotviewError("not-found", "that paste doesn't exist, has expired, or is private");
  }
  return { markdown: body.value.content, url: raw };
}

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
 * surl short links are fetched (and, like a click, keep an active link alive);
 * `/p` pastes are read from jotbins' Convex backend.
 *
 * @param {string} input
 * @param {{fetchImpl?: typeof fetch, convexFetchImpl?: typeof fetch}} [opts]
 *   `fetchImpl` reaches surl, `convexFetchImpl` reaches Convex
 * @returns {Promise<{markdown: string, url: string}>} `url` is the /d or /p link
 */
export async function readLink(input, opts = {}) {
  const raw = input.trim();
  let url;
  try { url = new URL(raw); } catch { throw notJotbins(); }
  const paste = url.protocol === "https:" && DOC_HOSTS.includes(url.host) && url.pathname.match(PASTE_PATH);
  if (paste) return readPaste(paste[1], raw, opts.convexFetchImpl ?? fetch);
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
