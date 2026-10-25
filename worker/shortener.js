import { shorten } from "../src/shorten.js";

/**
 * A `shortenImpl` for the Worker: uploads go through the surl service binding
 * (so surl's zone rate limit, keyed on IP, doesn't lump every claude.ai user
 * into one bucket) behind this Worker's own per-client limit. Over the limit
 * it fails soft, like any shortener failure: the caller keeps the full link.
 *
 * @param {{SURL?: {fetch: typeof fetch}, UPLOADS?: {limit: (o: {key: string}) => Promise<{success: boolean}>}}} env
 * @param {string} client  the caller's IP
 * @returns {typeof shorten}
 */
export function surlShortener(env, client) {
  return async (url, options = {}) => {
    if (env.UPLOADS) {
      const { success } = await env.UPLOADS.limit({ key: client });
      if (!success) return { ok: false, reason: "upload limit reached, try again in a minute" };
    }
    const fetchImpl = env.SURL ? (input, init) => env.SURL.fetch(input, init) : undefined;
    return shorten(url, { ...options, fetchImpl });
  };
}
