import { test } from "node:test";
import assert from "node:assert/strict";
import { openCommand, copyCommand, openUrl, copyText } from "../src/platform.js";

test("openCommand picks the right launcher per platform", () => {
  assert.deepEqual(openCommand("darwin"), { cmd: "open", args: [] });
  assert.deepEqual(openCommand("linux"), { cmd: "xdg-open", args: [] });
  assert.deepEqual(openCommand("win32"), { cmd: "cmd", args: ["/c", "start", ""] });
});

test("copyCommand picks the right clipboard tool per platform", () => {
  assert.deepEqual(copyCommand("darwin"), { cmd: "pbcopy", args: [] });
  assert.deepEqual(copyCommand("win32"), { cmd: "clip", args: [] });
  assert.deepEqual(copyCommand("linux"), { cmd: "xclip", args: ["-selection", "clipboard"] });
});

test("openCommand rejects an unknown platform", () => {
  assert.throws(() => openCommand("sunos"), /unsupported platform/i);
});

test("openUrl spawns the launcher with the URL appended", () => {
  const calls = [];
  const fake = (cmd, args) => { calls.push({ cmd, args }); return { status: 0 }; };
  const result = openUrl("https://jotbins.com/d#z:x", { platform: "darwin", spawnImpl: fake });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [{ cmd: "open", args: ["https://jotbins.com/d#z:x"] }]);
});

test("openUrl reports failure rather than throwing when the launcher is missing", () => {
  const fake = () => ({ status: null, error: new Error("spawn open ENOENT") });
  const result = openUrl("https://x", { platform: "darwin", spawnImpl: fake });
  assert.equal(result.ok, false);
  assert.match(result.reason, /ENOENT/);
});

test("openUrl reports failure on a non-zero exit", () => {
  const fake = () => ({ status: 3 });
  const result = openUrl("https://x", { platform: "linux", spawnImpl: fake });
  assert.equal(result.ok, false);
  assert.match(result.reason, /3/);
});

test("copyText pipes the text in on stdin", () => {
  const calls = [];
  const fake = (cmd, args, options) => { calls.push({ cmd, args, options }); return { status: 0 }; };
  const result = copyText("hello", { platform: "darwin", spawnImpl: fake });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].cmd, "pbcopy");
  assert.equal(calls[0].options.input, "hello");
});

test("copyText reports failure on an unsupported platform", () => {
  const result = copyText("hello", { platform: "sunos", spawnImpl: () => ({ status: 0 }) });
  assert.equal(result.ok, false);
});
