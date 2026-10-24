import { test } from "node:test";
import assert from "node:assert/strict";
import { mint } from "../src/mint.js";
import { DEFAULT_BASE_URL } from "../src/shorten.js";

const SHORT = "https://surl.jotbins.com/abc123";

/** Varied text: deflate crushes repetition, so a repeated filler would stay small. */
function doc(sections) {
  return "# Big\n\n" + Array.from({ length: sections }, (_, i) => `## Section ${i} text ${i * 7919}\n`).join("");
}

/** A shortener stub that records how it was called. */
function stub(result = { ok: true, short: SHORT }) {
  const calls = [];
  const impl = async (url, options) => { calls.push({ url, options }); return result; };
  return { calls, impl };
}

test("a small doc under auto stays a full link and is never uploaded", async () => {
  const s = stub();
  const r = await mint("# Hi\n", { shortenImpl: s.impl });
  assert.equal(s.calls.length, 0);
  assert.equal(r.shortened, false);
  assert.ok(r.url.startsWith(`${DEFAULT_BASE_URL}/d#z:`));
  assert.equal(r.url, r.rawUrl);
});

test("a big doc under auto is shortened", async () => {
  const s = stub();
  const r = await mint(doc(2000), { shortenImpl: s.impl });
  assert.equal(r.url, SHORT);
  assert.equal(r.shortened, true);
  assert.equal(r.permanent, false);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].options.permanent, false);
  assert.ok(r.rawUrl.length > 2000);
});

test("keep asks for a permanent link", async () => {
  const s = stub();
  const r = await mint(doc(2000), { keep: true, shortenImpl: s.impl });
  assert.equal(s.calls[0].options.permanent, true);
  assert.equal(r.permanent, true);
});

test("never keeps the full link even when big; always shortens even when small", async () => {
  const s = stub();
  const never = await mint(doc(2000), { shorten: "never", shortenImpl: s.impl });
  assert.equal(never.shortened, false);
  assert.equal(s.calls.length, 0);

  const always = await mint("# Hi\n", { shorten: "always", shortenImpl: s.impl });
  assert.equal(always.shortened, true);
  assert.equal(s.calls.length, 1);
});

test("a lower threshold shortens links the default would leave alone", async () => {
  const md = doc(60);
  const s = stub();
  const plain = await mint(md, { shortenImpl: s.impl });
  assert.ok(plain.rawUrl.length > 500 && plain.rawUrl.length <= 2000, `got ${plain.rawUrl.length}`);
  assert.equal(plain.shortened, false);

  const low = await mint(md, { threshold: 500, shortenImpl: s.impl });
  assert.equal(low.shortened, true);
});

test("uploads turned off never calls the shortener and says why", async () => {
  const s = stub();
  const big = await mint(doc(2000), { allowUpload: false, shortenImpl: s.impl });
  assert.equal(big.shortened, false);
  assert.equal(big.skipped, "uploads-off");

  const always = await mint("# Hi\n", { shorten: "always", allowUpload: false, shortenImpl: s.impl });
  assert.equal(always.skipped, "uploads-off");

  const small = await mint("# Hi\n", { allowUpload: false, shortenImpl: s.impl });
  assert.equal(small.skipped, null);
  assert.equal(s.calls.length, 0);
});

test("a custom base URL is never shortened", async () => {
  const s = stub();
  const r = await mint(doc(2000), { baseUrl: "http://localhost:5173", shortenImpl: s.impl });
  assert.equal(s.calls.length, 0);
  assert.equal(r.skipped, "custom-base");
  assert.ok(r.url.startsWith("http://localhost:5173/d#z:"));
});

test("a failed shorten falls back to the full link and reports the reason", async () => {
  const s = stub({ ok: false, reason: "shortener returned 429" });
  const r = await mint(doc(2000), { shortenImpl: s.impl });
  assert.equal(r.url, r.rawUrl);
  assert.equal(r.shortened, false);
  assert.equal(r.failure, "shortener returned 429");
});

test("empty and oversized content throw like encode()", async () => {
  await assert.rejects(mint("  \n", {}), /empty/);
  await assert.rejects(mint("x".repeat(1_000_001), {}), /limit/);
});
