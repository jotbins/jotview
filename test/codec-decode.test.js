import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { decode, encode, JotviewError, MAX_DOC_BYTES } from "../src/codec.js";

const { vectors } = JSON.parse(readFileSync(new URL("../vectors.json", import.meta.url)));

const code = (fn) => {
  try { fn(); } catch (err) { assert.ok(err instanceof JotviewError); return err.code; }
  assert.fail("expected a JotviewError");
};

test("decode: every pinned vector decodes to its markdown", () => {
  for (const v of vectors) assert.equal(decode(v.payload), v.markdown, v.name);
});

test("decode round-trips encode", () => {
  const md = "# Plan\n\n```mermaid\ngraph LR; A-->B\n```\n\nünïcödé ✓ 🚢\n";
  assert.equal(decode(encode(md)), md);
});

test("decode: malformed payloads are bad-link", () => {
  assert.equal(code(() => decode("U1bwSM3JyecCAA")), "bad-link"); // no z: prefix
  assert.equal(code(() => decode("z:not base64!")), "bad-link");
  assert.equal(code(() => decode("z:AAAA")), "bad-link"); // not deflate
});

test("decode refuses output over MAX_DOC_BYTES (zip bomb)", () => {
  const bomb = "z:" + deflateRawSync(Buffer.alloc(MAX_DOC_BYTES + 1, 97)).toString("base64url");
  assert.equal(code(() => decode(bomb)), "too-large");
});
