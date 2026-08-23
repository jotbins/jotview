import { readFileSync } from "node:fs";
import { encode, JotviewError, MAX_DOC_BYTES } from "./codec.js";
import {
  shorten, shouldShorten, DEFAULT_BASE_URL, SHORTEN_THRESHOLD, SHORTENER_URL,
} from "./shorten.js";
import { openUrl, copyText } from "./platform.js";
export { DEFAULT_BASE_URL };

/** Host the failed-shorten disclosure points to — derived from SHORTENER_URL
 *  so the two never drift apart. */
const SHORTENER_HOST = new URL(SHORTENER_URL).host;

export const HELP = `jotview — turn markdown into a jotbins /d link

Usage:
  jotview <file>            mint a link from a file
  jotview                   read markdown from stdin

Options:
  --raw                     never shorten; always the full /d URL
  --short                   always shorten, even when small
  --open                    open the link in your browser
  --copy                    copy the link to your clipboard
  --base-url <url>          override ${DEFAULT_BASE_URL}
  -h, --help                show this help
  -v, --version             show the version

Links 2000 characters or fewer are printed as-is and never leave your machine.
Longer ones are shortened via surl.jotbins.com, which uploads the document.
Use --raw to keep it local regardless of size.
`;

/**
 * @typedef {object} Options
 * @property {string|null} file
 * @property {boolean} raw
 * @property {boolean} short
 * @property {boolean} open
 * @property {boolean} copy
 * @property {string} baseUrl
 * @property {boolean} help
 * @property {boolean} version
 */

/**
 * @param {string[]} argv
 * @returns {Options}
 */
export function parseArgs(argv) {
  /** @type {Options} */
  const opts = {
    file: null, raw: false, short: false, open: false, copy: false,
    baseUrl: DEFAULT_BASE_URL, help: false, version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--raw": opts.raw = true; break;
      case "--short": opts.short = true; break;
      case "--open": opts.open = true; break;
      case "--copy": opts.copy = true; break;
      case "-h": case "--help": opts.help = true; break;
      case "-v": case "--version": opts.version = true; break;
      case "--base-url": {
        const value = argv[++i];
        if (
          value === undefined || value.startsWith("-") || !/^https?:\/\//.test(value)
        ) {
          throw new JotviewError(
            "usage",
            "--base-url needs an absolute http:// or https:// URL",
          );
        }
        opts.baseUrl = value.replace(/\/+$/, "");
        break;
      }
      default:
        if (arg.startsWith("-")) throw new JotviewError("usage", `unknown flag: ${arg}`);
        if (opts.file !== null) throw new JotviewError("usage", "pass at most one file");
        opts.file = arg;
    }
  }
  if (opts.raw && opts.short) {
    throw new JotviewError("usage", "--raw and --short cannot be combined");
  }
  if (opts.short && opts.baseUrl !== DEFAULT_BASE_URL) {
    throw new JotviewError("usage", `--short only works with ${DEFAULT_BASE_URL}`);
  }
  return opts;
}

/** @param {import("node:stream").Readable} stdin */
async function readStdin(stdin) {
  /** @type {Buffer[]} */
  const chunks = [];
  let total = 0;
  for await (const chunk of stdin) {
    total += chunk.length;
    // Check before buffering the chunk so a runaway pipe fails fast instead
    // of accumulating unbounded memory on its way to the same rejection
    // `encode()` would eventually throw anyway.
    if (total > MAX_DOC_BYTES) {
      throw new JotviewError(
        "too-large",
        `document is at least ${total} bytes; the limit is ${MAX_DOC_BYTES}`,
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * @param {Options} opts
 * @param {{stdin: import("node:stream").Readable}} io
 */
async function readInput(opts, io) {
  if (opts.file === null) return readStdin(io.stdin);
  try {
    return readFileSync(opts.file, "utf8");
  } catch (err) {
    const reason = /** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT"
      ? "no such file"
      : /** @type {Error} */ (err).message;
    throw new JotviewError("read-failed", `cannot read ${opts.file}: ${reason}`);
  }
}

/**
 * Side effects that must never change the exit code — the URL is already on
 * stdout, so a missing `xclip` is a warning, not a failure.
 * @param {string} url
 * @param {Options} opts
 * @param {{stderr: (s: string) => void, spawnImpl?: Function}} io
 */
function applySideEffects(url, opts, io) {
  if (opts.copy) {
    const result = copyText(url, { spawnImpl: io.spawnImpl });
    if (!result.ok) io.stderr(`note: could not copy (${result.reason}).\n`);
  }
  if (opts.open) {
    const result = openUrl(url, { spawnImpl: io.spawnImpl });
    if (!result.ok) io.stderr(`note: could not open a browser (${result.reason}).\n`);
  }
}

/**
 * @param {string[]} argv
 * @param {{stdout: (s: string) => void, stderr: (s: string) => void,
 *          stdin: import("node:stream").Readable, isTTY: boolean,
 *          version: string, spawnImpl?: Function}} io
 *   `spawnImpl` is optional and test-only — it is threaded down to
 *   `openUrl`/`copyText` so tests can assert on the command that would have
 *   been spawned without touching a real browser or clipboard. `bin/jotview.js`
 *   never sets it, so real usage is unaffected.
 * @returns {Promise<number>} exit code
 */
export async function run(argv, io) {
  /** @type {Options} */
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    io.stderr(`jotview: ${/** @type {Error} */ (err).message}\n\n${HELP}`);
    return 2;
  }

  if (opts.help) { io.stdout(HELP); return 0; }
  if (opts.version) { io.stdout(`${io.version}\n`); return 0; }

  // Nothing piped in and no file named: block forever, or help. Help.
  if (opts.file === null && io.isTTY) { io.stdout(HELP); return 0; }

  try {
    const md = await readInput(opts, io);
    if (md.trim() === "") throw new JotviewError("empty", "input is empty");
    const rawUrl = `${opts.baseUrl}/d#${encode(md)}`;

    if (!shouldShorten(rawUrl, opts)) {
      // Over the threshold, but the host isn't the shortenable default —
      // don't nag about it on documents that were never going to need it.
      if (opts.baseUrl !== DEFAULT_BASE_URL && rawUrl.length > SHORTEN_THRESHOLD) {
        io.stderr(
          `note: shortening skipped — only ${DEFAULT_BASE_URL} links can be ` +
            "shortened. using the full link.\n",
        );
      }
      io.stdout(`${rawUrl}\n`);
      applySideEffects(rawUrl, opts, io);
      return 0;
    }

    const result = await shorten(rawUrl);
    let printed = rawUrl;
    if (result.ok) {
      printed = result.short;
      io.stderr(
        `note: uploaded to jotbins to shorten (${rawUrl.length} → ` +
          `${printed.length} chars). use --raw to keep it local.\n`,
      );
    } else {
      io.stderr(
        `note: upload to the shortener failed (${result.reason}); using the full ` +
          `link. the document may still have reached ${SHORTENER_HOST}.\n`,
      );
    }
    io.stdout(`${printed}\n`);
    applySideEffects(printed, opts, io);
    return 0;
  } catch (err) {
    io.stderr(`jotview: ${/** @type {Error} */ (err).message}\n`);
    return 1;
  }
}
