import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { encode, JotviewError, PREFIX, MAX_DOC_BYTES } from "../src/codec.js";

const { vectors } = JSON.parse(readFileSync(new URL("../vectors.json", import.meta.url)));

/** Independent decoder — deliberately not imported from src. */
function decodePayload(payload) {
  assert.ok(payload.startsWith(PREFIX), `missing ${PREFIX} prefix`);
  const b64 = payload.slice(PREFIX.length).replaceAll("-", "+").replaceAll("_", "/");
  return inflateRawSync(Buffer.from(b64, "base64")).toString("utf8");
}

test("every pinned vector decodes to its stated markdown", () => {
  for (const v of vectors) {
    assert.equal(decodePayload(v.payload), v.markdown, `vector ${v.name}`);
  }
});

test("encode round-trips every vector's markdown", () => {
  for (const v of vectors) {
    assert.equal(decodePayload(encode(v.markdown)), v.markdown, `vector ${v.name}`);
  }
});

test("encode emits the z: prefix", () => {
  assert.ok(encode("# hi\n").startsWith("z:"));
});

test("encode output is base64url — no +, /, or = padding", () => {
  const payload = encode("# Title\n\n" + "lorem ipsum dolor sit amet ".repeat(200));
  const body = payload.slice(PREFIX.length);
  assert.ok(!/[+/=]/.test(body), `found non-base64url chars in ${body.slice(0, 40)}…`);
});

test("encode round-trips a large realistic document", () => {
  const md = Array.from({ length: 500 }, (_, i) => `## Section ${i}\n\nText ${i}.\n`).join("");
  assert.equal(decodePayload(encode(md)), md);
});

test("encode rejects input over MAX_DOC_BYTES", () => {
  const tooBig = "x".repeat(MAX_DOC_BYTES + 1);
  assert.throws(() => encode(tooBig), (err) => {
    assert.ok(err instanceof JotviewError);
    assert.equal(err.code, "too-large");
    return true;
  });
});

test("the cap counts UTF-8 bytes, not characters", () => {
  // Each emoji is 4 bytes, so this is ~2 MB in 500k characters.
  const emoji = "🎉".repeat(MAX_DOC_BYTES / 2);
  assert.throws(() => encode(emoji), { code: "too-large" });
});
