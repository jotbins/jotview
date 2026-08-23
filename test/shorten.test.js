import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  shorten, shouldShorten, SHORTEN_THRESHOLD, DEFAULT_BASE_URL,
} from "../src/shorten.js";

/** Spin up a stub shortener that replies with `status` and `body`. */
async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}/api/create`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const short = `${DEFAULT_BASE_URL}/d#z:tiny`;
const long = `${DEFAULT_BASE_URL}/d#z:${"a".repeat(SHORTEN_THRESHOLD)}`;

test("shouldShorten: under threshold, default options => false", () => {
  assert.equal(shouldShorten(short, { raw: false, short: false, baseUrl: DEFAULT_BASE_URL }), false);
});

test("shouldShorten: over threshold, default options => true", () => {
  assert.equal(shouldShorten(long, { raw: false, short: false, baseUrl: DEFAULT_BASE_URL }), true);
});

test("shouldShorten: --raw always wins", () => {
  assert.equal(shouldShorten(long, { raw: true, short: false, baseUrl: DEFAULT_BASE_URL }), false);
});

test("shouldShorten: --short forces it below the threshold", () => {
  assert.equal(shouldShorten(short, { raw: false, short: true, baseUrl: DEFAULT_BASE_URL }), true);
});

test("shouldShorten: a custom base URL is never shortenable", () => {
  assert.equal(
    shouldShorten(long, { raw: false, short: false, baseUrl: "http://localhost:5173" }),
    false,
  );
});

test("shorten: a 200 returns the short URL", async () => {
  await withServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ short_url: "https://surl.jotbins.com/abc123" }));
  }, async (endpoint) => {
    const result = await shorten(long, { endpoint });
    assert.deepEqual(result, { ok: true, short: "https://surl.jotbins.com/abc123" });
  });
});

test("shorten: a 429 fails soft", async () => {
  await withServer((req, res) => {
    res.writeHead(429);
    res.end("rate limited");
  }, async (endpoint) => {
    const result = await shorten(long, { endpoint });
    assert.equal(result.ok, false);
    assert.match(result.reason, /429|rate/i);
  });
});

test("shorten: a 500 fails soft", async () => {
  await withServer((req, res) => {
    res.writeHead(500);
    res.end("boom");
  }, async (endpoint) => {
    assert.equal((await shorten(long, { endpoint })).ok, false);
  });
});

test("shorten: malformed JSON fails soft", async () => {
  await withServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("not json at all");
  }, async (endpoint) => {
    assert.equal((await shorten(long, { endpoint })).ok, false);
  });
});

test("shorten: connection refused fails soft", async () => {
  // Port 1 is reserved and nothing listens there.
  const result = await shorten(long, { endpoint: "http://127.0.0.1:1/api/create" });
  assert.equal(result.ok, false);
});

test("shorten: posts the URL as JSON", async () => {
  let seen = null;
  await withServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen = JSON.parse(Buffer.concat(chunks).toString());
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ short_url: "https://surl.jotbins.com/xyz" }));
    });
  }, async (endpoint) => {
    await shorten(long, { endpoint });
  });
  assert.deepEqual(seen, { url: long });
});
