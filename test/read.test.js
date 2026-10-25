import { test } from "node:test";
import assert from "node:assert/strict";
import { readLink } from "../src/read.js";
import { encode, JotviewError } from "../src/codec.js";

const MD = "# Hello\n\nworld & <friends>\n";
const D_LINK = `https://jotbins.com/d#${encode(MD)}`;

/** A stub fetch answering with `response`, recording what it was asked. */
function stub(response) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ input: String(input), init });
    if (response instanceof Error) throw response;
    return response;
  };
  return { calls, fetchImpl };
}

const waitingPage = (href) =>
  `<html><body><a class="btn btn-primary" id="continue" href="${href}">Continue →</a></body></html>`;

async function errorOf(promise) {
  try { await promise; } catch (err) { assert.ok(err instanceof JotviewError, String(err)); return err; }
  assert.fail("expected a JotviewError");
}

test("a /d link decodes locally, no fetch", async () => {
  const { calls, fetchImpl } = stub(new Error("should not fetch"));
  const r = await readLink(D_LINK, { fetchImpl });
  assert.deepEqual(r, { markdown: MD, url: D_LINK });
  assert.equal(calls.length, 0);
});

test("surrounding whitespace and www. are fine", async () => {
  const r = await readLink(`  ${D_LINK.replace("://", "://www.")}\n`, { fetchImpl: stub(new Error()).fetchImpl });
  assert.equal(r.markdown, MD);
});

test("a permanent surl link: 302 Location is decoded", async () => {
  const { calls, fetchImpl } = stub(new Response(null, { status: 302, headers: { location: D_LINK } }));
  const r = await readLink("https://surl.jotbins.com/abc123", { fetchImpl });
  assert.equal(r.markdown, MD);
  assert.equal(calls[0].input, "https://surl.jotbins.com/abc123");
  assert.equal(calls[0].init.redirect, "manual");
});

test("an active surl link: the waiting page's continue href is decoded", async () => {
  const html = waitingPage(D_LINK.replaceAll("&", "&amp;"));
  const { fetchImpl } = stub(new Response(html, { status: 200 }));
  const r = await readLink("https://surl.jotbins.com/abc123", { fetchImpl });
  assert.equal(r.markdown, MD);
  assert.equal(r.url, D_LINK);
});

test("a soft-deleted surl link says it can be rescued, with the purge date", async () => {
  const html = '<strong id="deleted">3 Oct</strong> <span id="purge">2 December 2026</span>';
  const err = await errorOf(readLink("https://surl.jotbins.com/abc123", { fetchImpl: stub(new Response(html)).fetchImpl }));
  assert.equal(err.code, "cleaned-up");
  assert.match(err.message, /2 December 2026/);
  assert.match(err.message, /browser/);
});

test("a missing surl link is not-found", async () => {
  const err = await errorOf(readLink("https://surl.jotbins.com/nope", { fetchImpl: stub(new Response("x", { status: 404 })).fetchImpl }));
  assert.equal(err.code, "not-found");
});

test("a network failure is read-failed", async () => {
  const err = await errorOf(readLink("https://surl.jotbins.com/abc", { fetchImpl: stub(new Error("ECONNRESET")).fetchImpl }));
  assert.equal(err.code, "read-failed");
  assert.match(err.message, /ECONNRESET/);
});

test("a short link pointing somewhere other than /d is bad-link", async () => {
  const { fetchImpl } = stub(new Response(null, { status: 302, headers: { location: "https://jotbins.com/p/abc" } }));
  assert.equal((await errorOf(readLink("https://surl.jotbins.com/abc", { fetchImpl }))).code, "bad-link");
});

test("other links are refused without any fetch", async () => {
  const { calls, fetchImpl } = stub(new Error("should not fetch"));
  for (const url of [
    "https://evil.example/d#z:AwA",
    "https://jotbins.com/p/abc123",
    "http://surl.jotbins.com/abc",
    "https://surl.jotbins.com/api/create",
    "https://surl.jotbins.com/",
    "not a url",
  ]) {
    assert.equal((await errorOf(readLink(url, { fetchImpl }))).code, "bad-link", url);
  }
  assert.equal(calls.length, 0);
});
