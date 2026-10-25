import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { run, DEFAULT_BASE_URL } from "../src/cli.js";
import { encode } from "../src/codec.js";

const execFileAsync = promisify(execFile);
const BIN = new URL("../bin/jotview.js", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "jotview-"));

/** Run the real binary. Never throws; returns the outcome for assertion. */
async function runCli(args, { input } = {}) {
  try {
    const child = execFileAsync(process.execPath, [BIN, ...args]);
    // If the child exits (e.g. an oversized-input test rejects) before this
    // process has finished writing a large `input`, the write side sees
    // EPIPE. That is expected here and not the thing under test, so swallow
    // it rather than letting an unhandled stream error crash the test run.
    child.child.stdin.on("error", () => {});
    if (input !== undefined) {
      child.child.stdin.end(input);
    } else {
      child.child.stdin.end();
    }
    const { stdout, stderr } = await child;
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function fixture(name, content) {
  const p = join(dir, name);
  writeFileSync(p, content, "utf8");
  return p;
}

test("prints a /d link for a file", async () => {
  const p = fixture("hello.md", "# Hello\n");
  const { code, stdout } = await runCli([p, "--raw"]);
  assert.equal(code, 0);
  assert.match(stdout.trim(), /^https:\/\/jotbins\.com\/d#z:[A-Za-z0-9\-_]+$/);
});

test("stdout carries only the URL — nothing else", async () => {
  const p = fixture("only.md", "# Only\n");
  const { stdout } = await runCli([p, "--raw"]);
  assert.equal(stdout.trim().split("\n").length, 1);
});

test("reads markdown from stdin", async () => {
  const { code, stdout } = await runCli(["--raw"], { input: "# From stdin\n" });
  assert.equal(code, 0);
  assert.match(stdout.trim(), /^https:\/\/jotbins\.com\/d#z:/);
});

test("--base-url overrides the host", async () => {
  const p = fixture("base.md", "# Base\n");
  const { stdout } = await runCli([p, "--base-url", "http://localhost:5173", "--raw"]);
  assert.match(stdout.trim(), /^http:\/\/localhost:5173\/d#z:/);
});

test("--base-url rejects a missing value", async () => {
  const p = fixture("base-missing.md", "# Base\n");
  const { code, stderr } = await runCli([p, "--base-url"]);
  assert.equal(code, 2);
  assert.match(stderr, /--base-url/);
  assert.match(stderr, /Usage:/);
});

test("--base-url rejects a value that looks like another flag", async () => {
  const p = fixture("base-flag.md", "# Base\n");
  const { code, stdout, stderr } = await runCli([p, "--base-url", "--raw"]);
  assert.equal(code, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /--base-url/);
  assert.match(stderr, /Usage:/);
});

test("--base-url rejects a value without an http(s) scheme", async () => {
  const p = fixture("base-scheme.md", "# Base\n");
  const { code, stdout, stderr } = await runCli([p, "--base-url", "ftp://example.com"]);
  assert.equal(code, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /--base-url/);
  assert.match(stderr, /Usage:/);
});

test("--base-url rejects an empty value", async () => {
  const p = fixture("base-empty.md", "# Base\n");
  const { code, stderr } = await runCli([p, "--base-url", ""]);
  assert.equal(code, 2);
  assert.match(stderr, /--base-url/);
});

test("--help exits 0 and writes usage to stdout", async () => {
  const { code, stdout } = await runCli(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /jotview/);
  assert.match(stdout, /--raw/);
});

test("--version prints the package version", async () => {
  const { code, stdout } = await runCli(["--version"]);
  assert.equal(code, 0);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test("missing file exits 1 with an error on stderr and empty stdout", async () => {
  const { code, stdout, stderr } = await runCli([join(dir, "nope.md")]);
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /nope\.md/);
});

test("empty input exits 1", async () => {
  const p = fixture("empty.md", "");
  const { code, stderr } = await runCli([p]);
  assert.equal(code, 1);
  assert.match(stderr, /empty/i);
});

test("--raw with --short is a usage error (exit 2)", async () => {
  const p = fixture("both.md", "# Both\n");
  const { code, stderr } = await runCli([p, "--raw", "--short"]);
  assert.equal(code, 2);
  assert.match(stderr, /--raw/);
});

test("--keep with --raw is a usage error (exit 2)", async () => {
  const p = fixture("keep-raw.md", "# Keep\n");
  const { code, stderr } = await runCli([p, "--raw", "--keep"]);
  assert.equal(code, 2);
  assert.match(stderr, /--keep/);
});

test("--help documents --keep and the 30-day expiry", async () => {
  const { stdout } = await runCli(["--help"]);
  assert.match(stdout, /--keep/);
  assert.match(stdout, /30 days/);
});

test("unknown flag is a usage error (exit 2)", async () => {
  const p = fixture("unknown.md", "# U\n");
  const { code, stderr } = await runCli([p, "--wat"]);
  assert.equal(code, 2);
  assert.match(stderr, /--wat/);
});

test("oversized input exits 1 and names the size", async () => {
  const p = fixture("big.md", "x".repeat(1_000_001));
  const { code, stdout, stderr } = await runCli([p]);
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /1000001|limit/);
});

test("a runaway stdin pipe exits 1 and names the limit instead of buffering it all", async () => {
  // Several times MAX_DOC_BYTES: readStdin() must reject once the running
  // total crosses the limit, not after accumulating the entire input.
  const { code, stdout, stderr } = await runCli([], { input: "x".repeat(5_000_000) });
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /limit/);
});

test("a small document is not shortened and stays local", async () => {
  const p = fixture("small.md", "# Small\n");
  const { code, stdout, stderr } = await runCli([p]);
  assert.equal(code, 0);
  assert.match(stdout.trim(), /^https:\/\/jotbins\.com\/d#z:/);
  assert.doesNotMatch(stderr, /uploaded/);
});

test("--short with a custom base URL is a usage error, detected before any I/O", async () => {
  // Name a file that does not exist: if the check fired only after reading
  // input (the old bug), this would instead fail with a read error.
  const { code, stdout, stderr } = await runCli([
    join(dir, "does-not-exist.md"), "--base-url", "http://localhost:5173", "--short",
  ]);
  assert.equal(code, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /--short/);
  assert.match(stderr, /Usage:/);
});

test("a large document with a custom base URL emits the raw link, no upload, and notes shortening was skipped", async () => {
  // Varied per-line text, not a repeated string — repetition compresses so
  // well that the resulting URL would land back under the threshold and this
  // test would no longer exercise the skip-note path at all.
  const md = "# Big\n\n" + Array.from(
    { length: 2000 },
    (_, i) => `## Section ${i} with unique text ${i}\n`,
  ).join("");
  const p = fixture("large-custom.md", md);

  const rawUrl = `http://localhost:5173/d#${encode(md)}`;
  assert.ok(rawUrl.length > 2000, `expected rawUrl over 2000 chars, got ${rawUrl.length}`);

  const { code, stdout, stderr } = await runCli([p, "--base-url", "http://localhost:5173"]);
  assert.equal(code, 0);
  assert.match(stdout.trim(), /^http:\/\/localhost:5173\/d#z:/);
  assert.doesNotMatch(stderr, /uploaded/);
  assert.match(stderr, /shortening skipped/);
  assert.match(stderr, new RegExp(DEFAULT_BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("a small document with a custom base URL does not nag about skipped shortening", async () => {
  const p = fixture("small-custom.md", "# Small\n");
  const { code, stdout, stderr } = await runCli([p, "--base-url", "http://localhost:5173"]);
  assert.equal(code, 0);
  assert.match(stdout.trim(), /^http:\/\/localhost:5173\/d#z:/);
  assert.doesNotMatch(stderr, /shortening skipped/);
});

test("upload disclosure: a shortened document warns on stderr with both lengths", async () => {
  // Varied text, not a repeated string — deflate crushes repetition, and a
  // repeated filler would compress down to a URL under the threshold and
  // silently take the "not shortened" branch instead of the one under test.
  const md = "# Big\n\n" + Array.from(
    { length: 2000 },
    (_, i) => `## Section ${i} with unique text ${i}\n`,
  ).join("");
  const p = fixture("upload.md", md);

  const rawUrl = `${DEFAULT_BASE_URL}/d#${encode(md)}`;
  assert.ok(rawUrl.length > 2000, `expected rawUrl over 2000 chars, got ${rawUrl.length}`);

  const shortUrl = "https://surl.jotbins.com/abc123";
  const originalFetch = globalThis.fetch;
  // Stub fetch for the duration of this test only — no network call is ever
  // made; the shortener response is fabricated locally and restored below.
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ short_url: shortUrl }),
  });

  let stdout = "";
  let stderr = "";
  try {
    const code = await run([p], {
      stdout: (s) => { stdout += s; },
      stderr: (s) => { stderr += s; },
      stdin: process.stdin,
      isTTY: false,
      version: "0.1.0",
    });

    assert.equal(code, 0);
    assert.equal(stdout, `${shortUrl}\n`);
    assert.match(stderr, /uploaded to jotbins to shorten/);
    assert.match(stderr, new RegExp(String(rawUrl.length)));
    assert.match(stderr, new RegExp(String(shortUrl.length)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a failed shorten admits the document may still have reached the shortener", async () => {
  // Varied text, not a repeated string — same reasoning as the upload
  // disclosure test: repetition compresses under the shorten threshold and
  // would silently skip the branch under test.
  const md = "# Big\n\n" + Array.from(
    { length: 2000 },
    (_, i) => `## Section ${i} with unique text ${i}\n`,
  ).join("");
  const p = fixture("shorten-fail.md", md);

  const rawUrl = `${DEFAULT_BASE_URL}/d#${encode(md)}`;
  assert.ok(rawUrl.length > 2000, `expected rawUrl over 2000 chars, got ${rawUrl.length}`);

  const originalFetch = globalThis.fetch;
  // Stub fetch for the duration of this test only — no network call is ever
  // made; the request body (containing the whole document) is never sent
  // anywhere real, but the point under test is that jotview cannot know
  // that from a 500 — the upload may have already landed server-side.
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({}),
  });

  let stdout = "";
  let stderr = "";
  try {
    const code = await run([p], {
      stdout: (s) => { stdout += s; },
      stderr: (s) => { stderr += s; },
      stdin: process.stdin,
      isTTY: false,
      version: "0.1.0",
    });

    assert.equal(code, 0);
    assert.equal(stdout, `${rawUrl}\n`);
    // The critical claim: a failed shorten must NOT be reported as though
    // nothing left the machine — the request body already went out.
    assert.match(stderr, /upload to the shortener failed/);
    assert.match(stderr, /may still have reached surl\.jotbins\.com/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("--copy receives the short URL, not the long one, after a successful shorten", async () => {
  // Varied text, not a repeated string — same reasoning as the upload
  // disclosure test: repetition compresses under the shorten threshold and
  // would silently skip the branch under test.
  const md = "# Big\n\n" + Array.from(
    { length: 2000 },
    (_, i) => `## Section ${i} with unique text ${i}\n`,
  ).join("");
  const p = fixture("copy-short.md", md);

  const rawUrl = `${DEFAULT_BASE_URL}/d#${encode(md)}`;
  assert.ok(rawUrl.length > 2000, `expected rawUrl over 2000 chars, got ${rawUrl.length}`);

  const shortUrl = "https://surl.jotbins.com/xyz789";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ short_url: shortUrl }),
  });

  // Recording fake stands in for spawnSync — no real clipboard command runs.
  const calls = [];
  const spawnImpl = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    return { status: 0 };
  };

  let stdout = "";
  try {
    const code = await run([p, "--copy"], {
      stdout: (s) => { stdout += s; },
      stderr: () => {},
      stdin: process.stdin,
      isTTY: false,
      version: "0.1.0",
      spawnImpl,
    });

    assert.equal(code, 0);
    assert.equal(calls.length, 1);
    // The text handed to the clipboard command is the short URL, never the
    // long one — this is the property that Task 4's `printed` variable exists
    // to guarantee.
    assert.equal(calls[0].options.input, shortUrl);
    assert.notEqual(calls[0].options.input, rawUrl);
    assert.equal(stdout, `${shortUrl}\n`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("--copy is best-effort: a failing clipboard command still exits 0 and warns on stderr", async () => {
  const p = fixture("copy-fail.md", "# Copy fail\n");
  const spawnImpl = () => ({ status: 1 });

  let stdout = "";
  let stderr = "";
  const code = await run([p, "--raw", "--copy"], {
    stdout: (s) => { stdout += s; },
    stderr: (s) => { stderr += s; },
    stdin: process.stdin,
    isTTY: false,
    version: "0.1.0",
    spawnImpl,
  });

  assert.equal(code, 0);
  assert.match(stdout.trim(), /^https:\/\/jotbins\.com\/d#z:[A-Za-z0-9\-_]+$/);
  assert.match(stderr, /could not copy/);
});

test("EPIPE: a downstream reader that exits early does not crash jotview", async () => {
  // Base64 of random bytes is close to incompressible by deflate (unlike
  // repeated filler), so the emitted URL scales ~1:1 with input size. Aim
  // comfortably past the 64 KB pipe buffer so the write is still in flight
  // — and can still receive EPIPE — when `head` closes its end early.
  const md = "# Big\n\n" + randomBytes(60_000).toString("base64");
  const p = fixture("epipe.md", md);
  const rawUrl = `${DEFAULT_BASE_URL}/d#${encode(md)}`;
  assert.ok(rawUrl.length > 65_536, `expected rawUrl over 64 KiB, got ${rawUrl.length}`);

  // `head -c 5` is the downstream reader that exits after 5 bytes, closing
  // its read end while jotview is still writing. PIPESTATUS[0] recovers
  // jotview's own exit code, since `exec()`'s callback otherwise reports
  // the exit status of the last command in the pipeline (`head`).
  const script = `${JSON.stringify(process.execPath)} ${JSON.stringify(BIN)} ` +
    `--raw ${JSON.stringify(p)} | head -c 5 >/dev/null; exit "\${PIPESTATUS[0]}"`;

  const code = await new Promise((resolve, reject) => {
    execFile("bash", ["-c", script], (err) => {
      if (err && typeof err.code !== "number") { reject(err); return; }
      resolve(err ? err.code : 0);
    });
  });

  assert.equal(code, 0);
});

/** Run `run()` on a document big enough to be shortened, with fetch stubbed. */
async function runShortened(name, extraArgs) {
  const md = "# Big\n\n" + Array.from(
    { length: 2000 },
    (_, i) => `## Section ${i} with unique text ${i}\n`,
  ).join("");
  const p = fixture(name, md);
  const originalFetch = globalThis.fetch;
  /** @type {any} */
  let sentBody;
  globalThis.fetch = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ short_url: "https://surl.jotbins.com/abc123" }) };
  };
  let stderr = "";
  try {
    const code = await run([p, ...extraArgs], {
      stdout: () => {},
      stderr: (s) => { stderr += s; },
      stdin: process.stdin,
      isTTY: false,
      version: "0.1.0",
    });
    return { code, stderr, sentBody };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("--keep asks the shortener for a permanent link and says so", async () => {
  const { code, stderr, sentBody } = await runShortened("keep.md", ["--keep"]);
  assert.equal(code, 0);
  assert.equal(sentBody.permanent, true);
  assert.match(stderr, /kept forever/);
});

test("a shortened link without --keep warns that it expires", async () => {
  const { code, stderr, sentBody } = await runShortened("expires.md", []);
  assert.equal(code, 0);
  assert.equal("permanent" in sentBody, false);
  assert.match(stderr, /expires after 30 days unused/);
  assert.match(stderr, /--keep/);
});

test("decode prints a /d link's markdown exactly, exit 0", async () => {
  const md = "# Round trip\n\nno trailing newline";
  const { code, stdout, stderr } = await runCli(["decode", `${DEFAULT_BASE_URL}/d#${encode(md)}`]);
  assert.equal(code, 0);
  assert.equal(stdout, md);
  assert.equal(stderr, "");
});

test("decode of a non-jotbins link: stderr, exit 1", async () => {
  const { code, stdout, stderr } = await runCli(["decode", "https://example.com/d#z:AwA"]);
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /only jotbins\.com\/d links/);
});

test("decode needs exactly one URL: usage, exit 2", async () => {
  for (const args of [["decode"], ["decode", "a", "b"], ["decode", "--raw"]]) {
    const { code, stderr } = await runCli(args);
    assert.equal(code, 2, args.join(" "));
    assert.match(stderr, /decode/);
  }
});

test("help lists decode", async () => {
  const { stdout } = await runCli(["--help"]);
  assert.match(stdout, /jotview decode <url>/);
});
