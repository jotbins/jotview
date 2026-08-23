/** Canonical jotbins host. Lives here rather than in cli.js so the two modules
 *  do not import each other: shortenability is this module's concern. */
export const DEFAULT_BASE_URL = "https://jotbins.com";

/** Where chat clients start refusing content — Discord's hard message cap.
 *  Not a server-side limit: the fragment never reaches a server. */
export const SHORTEN_THRESHOLD = 2000;

export const SHORTENER_URL = "https://surl.jotbins.com/api/create";

/** Milliseconds before giving up and emitting the raw URL instead. */
const TIMEOUT_MS = 5000;

/**
 * @param {string} url
 * @param {{raw: boolean, short: boolean, baseUrl: string}} opts
 * @returns {boolean}
 */
export function shouldShorten(url, opts) {
  if (opts.raw) return false;
  // surl's allowlist accepts only jotbins.com hosts, so a custom base URL can
  // never be shortened. Skip rather than fire a request guaranteed to 400.
  if (opts.baseUrl !== DEFAULT_BASE_URL) return false;
  if (opts.short) return true;
  return url.length > SHORTEN_THRESHOLD;
}

/**
 * Shorten a URL. Never throws — the caller falls back to the raw URL.
 * @param {string} url
 * @param {{endpoint?: string}} [options]
 * @returns {Promise<{ok: true, short: string} | {ok: false, reason: string}>}
 */
export async function shorten(url, options = {}) {
  const endpoint = options.endpoint ?? SHORTENER_URL;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, reason: `shortener returned ${response.status}` };
    }
    const data = await response.json();
    // The value ends up on stdout and, with --open, as an argv element handed
    // to `spawnSync("open", [value])`. Requiring an https:// scheme rules out
    // a misbehaving or compromised shortener returning something like "-a" or
    // a `javascript:` URL that a browser or shell would treat specially.
    if (typeof data?.short_url !== "string" || !data.short_url.startsWith("https://")) {
      return { ok: false, reason: "shortener returned an unexpected response" };
    }
    return { ok: true, short: data.short_url };
  } catch (err) {
    return { ok: false, reason: /** @type {Error} */ (err).message };
  }
}
