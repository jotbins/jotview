import { readFileSync } from "node:fs";
import { JotviewError, MAX_DOC_BYTES } from "./codec.js";
import { DEFAULT_BASE_URL, SHORTENER_URL } from "./shorten.js";
import { mint } from "./mint.js";
import { readLink } from "./read.js";
import { serve } from "./mcp-stdio.js";
import { renderTool } from "./mcp-tool.js";
import { readTool } from "./mcp-read-tool.js";
import { openUrl, copyText } from "./platform.js";
export { DEFAULT_BASE_URL };

/** Host the failed-shorten disclosure points to — derived from SHORTENER_URL
 *  so the two never drift apart. */
const SHORTENER_HOST = new URL(SHORTENER_URL).host;

export const HELP = `jotview — turn markdown into a jotbins /d link

Usage:
  jotview <file>            mint a link from a file
  jotview                   read markdown from stdin
  jotview decode <url>      print the markdown behind a /d or short link
  jotview mcp [--raw]       run as an MCP server (stdio) for AI agents;
                            --raw never uploads, --base-url works too

Options:
  --raw                     never shorten; always the full /d URL
  --short                   always shorten, even when small
  --keep                    make a shortened link permanent
  --open                    open the link in your browser
  --copy                    copy the link to your clipboard
  --json                    print {url, rawUrl, shortened, permanent, failure}
  --base-url <url>          override ${DEFAULT_BASE_URL}
  -h, --help                show this help
  -v, --version             show the version

Links 2000 characters or fewer are printed as-is and never leave your machine.
Longer ones are shortened via surl.jotbins.com, which uploads the document.
Use --raw to keep it local regardless of size.

Short links are deleted after 30 days unused, unless made with --keep or
saved from the link's waiting page. Full /d links never expire.
`;

/**
 * @typedef {object} Options
 * @property {string|null} file
 * @property {boolean} raw
 * @property {boolean} short
 * @property {boolean} keep
 * @property {boolean} open
 * @property {boolean} copy
 * @property {boolean} json
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
    file: null, raw: false, short: false, keep: false, open: false, copy: false, json: false,
    baseUrl: DEFAULT_BASE_URL, help: false, version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--raw": opts.raw = true; break;
      case "--short": opts.short = true; break;
      case "--keep": opts.keep = true; break;
      case "--open": opts.open = true; break;
      case "--copy": opts.copy = true; break;
      case "--json": opts.json = true; break;
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
  if (opts.raw && opts.keep) {
    throw new JotviewError("usage", "--keep has no effect with --raw: full links never expire");
  }
  if (opts.short && opts.baseUrl !== DEFAULT_BASE_URL) {
    throw new JotviewError("usage", `--short only works with ${DEFAULT_BASE_URL}`);
  }
  return opts;
}

/**
 * Flags after `jotview mcp`. Only the ones that mean something to a server.
 * @param {string[]} argv
 * @returns {{raw: boolean, baseUrl: string}}
 */
export function parseMcpArgs(argv) {
  const opts = { raw: false, baseUrl: DEFAULT_BASE_URL };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--raw") {
      opts.raw = true;
    } else if (arg === "--base-url") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("-") || !/^https?:\/\//.test(value)) {
        throw new JotviewError("usage", "--base-url needs an absolute http:// or https:// URL");
      }
      opts.baseUrl = value.replace(/\/+$/, "");
    } else {
      throw new JotviewError("usage", `jotview mcp does not take ${arg}`);
    }
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
  if (argv[0] === "mcp") return runMcp(argv.slice(1), io);
  if (argv[0] === "decode") return runDecode(argv.slice(1), io);

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
    const minted = await mint(md, {
      baseUrl: opts.baseUrl,
      shorten: opts.raw ? "never" : opts.short ? "always" : "auto",
      keep: opts.keep,
    });
    const printed = minted.url;

    if (minted.skipped === "custom-base") {
      // Only reported when the link was over the threshold — documents that
      // were never going to need shortening don't get nagged about it.
      io.stderr(
        `note: shortening skipped — only ${DEFAULT_BASE_URL} links can be ` +
          "shortened. using the full link.\n",
      );
    } else if (minted.shortened) {
      io.stderr(
        `note: uploaded to jotbins to shorten (${minted.rawUrl.length} → ` +
          `${printed.length} chars). use --raw to keep it local.\n`,
      );
      io.stderr(
        opts.keep
          ? "note: short link kept forever.\n"
          : "note: short link expires after 30 days unused. use --keep to keep it forever.\n",
      );
    } else if (minted.failure) {
      io.stderr(
        `note: upload to the shortener failed (${minted.failure}); using the full ` +
          `link. the document may still have reached ${SHORTENER_HOST}.\n`,
      );
    }
    if (opts.json) {
      const { url, rawUrl, shortened, permanent, failure } = minted;
      io.stdout(`${JSON.stringify({ url, rawUrl, shortened, permanent, failure })}\n`);
    } else {
      io.stdout(`${printed}\n`);
    }
    applySideEffects(printed, opts, io);
    return 0;
  } catch (err) {
    io.stderr(`jotview: ${/** @type {Error} */ (err).message}\n`);
    return 1;
  }
}

/**
 * `jotview decode <url>`: the markdown, byte for byte, on stdout — so
 * `jotview decode URL > doc.md` and `jotview decode URL | jotview` round-trip.
 * @param {string[]} argv
 * @param {Parameters<typeof run>[1]} io
 * @returns {Promise<number>}
 */
async function runDecode(argv, io) {
  if (argv.length !== 1 || argv[0].startsWith("-")) {
    io.stderr(`jotview: decode takes exactly one link\n\n${HELP}`);
    return 2;
  }
  try {
    const { markdown } = await readLink(argv[0]);
    io.stdout(markdown);
    return 0;
  } catch (err) {
    io.stderr(`jotview: ${/** @type {Error} */ (err).message}\n`);
    return 1;
  }
}

/**
 * `jotview mcp`: stdout belongs to the protocol from here on, so usage
 * errors go to stderr and nothing else is ever printed.
 * @param {string[]} argv
 * @param {Parameters<typeof run>[1]} io
 * @returns {Promise<number>}
 */
async function runMcp(argv, io) {
  let opts;
  try {
    opts = parseMcpArgs(argv);
  } catch (err) {
    io.stderr(`jotview: ${/** @type {Error} */ (err).message}\n\n${HELP}`);
    return 2;
  }
  await serve({
    input: io.stdin,
    write: io.stdout,
    ctx: {
      version: io.version,
      tools: [renderTool({ allowUpload: !opts.raw, baseUrl: opts.baseUrl }), readTool({})],
    },
  });
  return 0;
}
