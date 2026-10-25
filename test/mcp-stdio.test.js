import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const BIN = new URL("../bin/jotview.js", import.meta.url).pathname;

/**
 * Run `jotview mcp ...args`, feed it `input` (written as-is, then stdin is
 * closed) and collect what it prints.
 */
function session(args, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, "mcp", ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

const line = (obj) => `${JSON.stringify(obj)}\n`;
const lines = (stdout) => stdout.split("\n").filter(Boolean);

test("legacy session: initialize, list, call — one JSON line per request", async () => {
  const input =
    line({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) +
    line({ jsonrpc: "2.0", method: "notifications/initialized" }) +
    line({ jsonrpc: "2.0", id: 2, method: "tools/list" }) +
    line({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "render_markdown", arguments: { content: "# Hi\n\nthere" } } });
  const { code, stdout } = await session([], input);

  assert.equal(code, 0);
  const out = lines(stdout).map((l) => JSON.parse(l)); // throws if any line isn't JSON
  assert.equal(out.length, 3);
  const byId = Object.fromEntries(out.map((r) => [r.id, r]));
  assert.equal(byId[1].result.protocolVersion, "2025-06-18");
  assert.deepEqual(byId[2].result.tools.map((t) => t.name), ["render_markdown", "read_link"]);
  assert.match(byId[3].result.content[0].text, /^\[Hi\]\(https:\/\/jotbins\.com\/d#z:/);
});

test("modern session: discover then call with _meta", async () => {
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const input =
    line({ jsonrpc: "2.0", id: "a", method: "server/discover", params: { _meta: meta } }) +
    line({ jsonrpc: "2.0", id: "b", method: "tools/call", params: { name: "render_markdown", arguments: { content: "# Hi" }, _meta: meta } });
  const { stdout } = await session([], input);
  const out = Object.fromEntries(lines(stdout).map((l) => JSON.parse(l)).map((r) => [r.id, r]));
  assert.deepEqual(out.a.result.supportedVersions, ["2026-07-28"]);
  assert.equal(out.b.result.resultType, "complete");
});

test("a garbage line gets a parse error and the server keeps going", async () => {
  const input = "not json\n" + line({ jsonrpc: "2.0", id: 9, method: "ping" });
  const { stdout } = await session([], input);
  const out = lines(stdout).map((l) => JSON.parse(l));
  assert.equal(out[0].error.code, -32700);
  assert.equal(out[0].id, null);
  assert.deepEqual(out[1], { jsonrpc: "2.0", id: 9, result: {} });
});

test("a message split across writes is still read whole", async () => {
  const msg = line({ jsonrpc: "2.0", id: 1, method: "ping" });
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, "mcp"]);
    let stdout = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.on("close", () => resolve(stdout));
    child.stdin.write(msg.slice(0, 10));
    setTimeout(() => child.stdin.end(msg.slice(10)), 50);
  });
  assert.deepEqual(JSON.parse(result), { jsonrpc: "2.0", id: 1, result: {} });
});

test("--raw: a long doc comes back as the full link, never uploaded", async () => {
  const md = "# Big\n\n" + Array.from({ length: 300 }, (_, i) => `## Section ${i} text ${i * 7919}\n`).join("");
  const input = line({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "render_markdown", arguments: { content: md } } });
  const { stdout } = await session(["--raw"], input);
  const text = JSON.parse(stdout).result.content[0].text;
  assert.match(text, /\]\(https:\/\/jotbins\.com\/d#z:/);
  assert.match(text, /uploads are turned off/i);
});

test("an unknown flag after mcp is a usage error", async () => {
  const { code, stdout, stderr } = await session(["--short"], "");
  assert.equal(code, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /--short/);
});
