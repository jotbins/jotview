import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const BIN = new URL("../bin/jotview.js", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "jotview-"));

/** Run the real binary. Never throws; returns the outcome for assertion. */
async function runCli(args, { input } = {}) {
  try {
    const child = execFileAsync(process.execPath, [BIN, ...args]);
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
