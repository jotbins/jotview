import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTool, docTitle, MCP_SHORTEN_THRESHOLD } from "../src/mcp-tool.js";

const SHORT = "https://surl.jotbins.com/abc123";

function doc(sections) {
  return "# Big doc\n\n" + Array.from({ length: sections }, (_, i) => `## Section ${i} text ${i * 7919}\n`).join("");
}

/** A tool wired to a stub shortener that records its calls. */
function tool(opts = {}, result = { ok: true, short: SHORT }) {
  const calls = [];
  const shortenImpl = async (url, options) => { calls.push({ url, options }); return result; };
  return { calls, t: renderTool({ allowUpload: true, shortenImpl, ...opts }) };
}

const textOf = (res) => res.content[0].text;

test("definition: content required, shorten enum, no extra props, no output schema", () => {
  const { definition } = renderTool({});
  assert.equal(definition.name, "render_markdown");
  assert.deepEqual(definition.inputSchema.required, ["content"]);
  assert.deepEqual(definition.inputSchema.properties.shorten.enum, ["auto", "always", "never"]);
  assert.equal(definition.inputSchema.additionalProperties, false);
  assert.equal("outputSchema" in definition, false);
});

test("docTitle takes the first heading, escapes brackets, falls back", () => {
  assert.equal(docTitle("intro\n# Plan [v2]\n## sub"), "Plan \\[v2\\]");
  assert.equal(docTitle("## Only a subheading\n"), "Only a subheading");
  assert.equal(docTitle("no headings here"), "jotbins doc");
  assert.equal(docTitle(`# ${"x".repeat(200)}`).length, 80);
});

test("a small doc returns a markdown link to the full /d URL, nothing uploaded", async () => {
  const { t, calls } = tool();
  const res = await t.call({ content: "# Hello\n\nworld" });
  const text = textOf(res);
  assert.equal(calls.length, 0);
  assert.match(text.split("\n")[0], /^\[Hello\]\(https:\/\/jotbins\.com\/d#z:[^)]+\)$/);
  assert.match(text, /nothing was uploaded/i);
  assert.match(text, /markdown link/);
  assert.equal(res.isError, undefined);
  assert.equal("structuredContent" in res, false);
});

test("the URL appears exactly once in the result", async () => {
  const { t } = tool();
  const res = await t.call({ content: "# Hello\n\nworld" });
  const url = textOf(res).match(/\((https:[^)]+)\)/)[1];
  assert.equal(JSON.stringify(res).split(url).length - 1, 1);
});

test("MCP shortens from 500 chars, sooner than the CLI", async () => {
  assert.equal(MCP_SHORTEN_THRESHOLD, 500);
  const { t, calls } = tool();
  const res = await t.call({ content: doc(60) });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.length > 500 && calls[0].url.length <= 2000);
  assert.match(textOf(res).split("\n")[0], /^\[Big doc\]\(https:\/\/surl\.jotbins\.com\/abc123\)$/);
  assert.match(textOf(res), /uploaded to surl\.jotbins\.com/);
  assert.match(textOf(res), /30 days/);
  assert.match(textOf(res), /keep: true/);
});

test("keep makes the short link permanent", async () => {
  const { t, calls } = tool();
  const res = await t.call({ content: doc(60), keep: true });
  assert.equal(calls[0].options.permanent, true);
  assert.match(textOf(res), /permanent/);
  assert.doesNotMatch(textOf(res), /30 days/);
});

test("shorten: never keeps the full link", async () => {
  const { t, calls } = tool();
  await t.call({ content: doc(60), shorten: "never" });
  assert.equal(calls.length, 0);
});

test("a server started with --raw never uploads and says so", async () => {
  const { t, calls } = tool({ allowUpload: false });
  const res = await t.call({ content: doc(60), shorten: "always", keep: true });
  assert.equal(calls.length, 0);
  assert.match(textOf(res), /uploads are turned off/i);
  assert.match(textOf(res), /\]\(https:\/\/jotbins\.com\/d#z:/);
});

test("a failed shorten still returns the full link", async () => {
  const { t } = tool({}, { ok: false, reason: "shortener returned 429" });
  const res = await t.call({ content: doc(60) });
  assert.match(textOf(res), /\]\(https:\/\/jotbins\.com\/d#z:/);
  assert.match(textOf(res), /shortener returned 429/);
  assert.equal(res.isError, undefined);
});

test("bad input is a tool error the model can fix", async () => {
  const { t } = tool();
  for (const args of [{}, { content: "" }, { content: "   " }, { content: 42 }, { content: "# x", shorten: "sometimes" }, { content: "# x", keep: "yes" }]) {
    const res = await t.call(args);
    assert.equal(res.isError, true, JSON.stringify(args));
    assert.ok(textOf(res).length > 0);
  }
  const big = await t.call({ content: "x".repeat(1_000_001) });
  assert.equal(big.isError, true);
  assert.match(textOf(big), /limit/);
});
