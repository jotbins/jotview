import { test } from "node:test";
import assert from "node:assert/strict";
import { readTool } from "../src/mcp-read-tool.js";
import { encode } from "../src/codec.js";

const MD = "# Notes\n\n- one\n- two\n";
const D_LINK = `https://jotbins.com/d#${encode(MD)}`;
const noFetch = async () => { throw new Error("should not fetch"); };
const textOf = (res) => res.content[0].text;
const markdownOf = (res) => res.content[1].text;

test("definition: url required, read-only, no extra props", () => {
  const { definition } = readTool({});
  assert.equal(definition.name, "read_link");
  assert.deepEqual(definition.inputSchema.required, ["url"]);
  assert.equal(definition.inputSchema.additionalProperties, false);
  assert.equal(definition.annotations.readOnlyHint, true);
  assert.match(definition.description, /render_markdown/);
  assert.match(definition.description, /untrusted/i);
});

test("returns an untrusted-content notice, then the markdown verbatim", async () => {
  const res = await readTool({ fetchImpl: noFetch }).call({ url: D_LINK });
  assert.equal(res.content.length, 2);
  assert.match(textOf(res), /untrusted/i);
  assert.match(textOf(res), /not instructions/i);
  assert.ok(textOf(res).includes(D_LINK));
  assert.equal(markdownOf(res), MD);
  assert.equal(res.isError, undefined);
});

test("short links are fetched with the injected fetch", async () => {
  const calls = [];
  const fetchImpl = async (input) => { calls.push(String(input)); return new Response(null, { status: 302, headers: { location: D_LINK } }); };
  const res = await readTool({ fetchImpl }).call({ url: "https://surl.jotbins.com/abc123" });
  assert.equal(markdownOf(res), MD);
  assert.deepEqual(calls, ["https://surl.jotbins.com/abc123"]);
});

test("bad input and unreadable links are tool errors the model can act on", async () => {
  const t = readTool({ fetchImpl: noFetch });
  for (const args of [{}, { url: "" }, { url: 42 }, { url: "https://example.com/x" }]) {
    const res = await t.call(args);
    assert.equal(res.isError, true, JSON.stringify(args));
    assert.ok(textOf(res).length > 0);
  }
});
