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

test("title overrides the heading as link text, escaped and capped", async () => {
  const { t } = tool();
  const res = await t.call({ content: "# Heading\n\nbody", title: "  My [plan]  " });
  assert.match(textOf(res).split("\n")[0], /^\[My \\\[plan\\\]\]\(https:/);
  const long = await t.call({ content: "# x", title: "y".repeat(200) });
  assert.match(textOf(long).split("\n")[0], /^\[y{80}\]\(/);
});

test("title must be a non-empty string", async () => {
  const { t } = tool();
  for (const title of ["", "   ", 7]) {
    assert.equal((await t.call({ content: "# x", title })).isError, true, JSON.stringify(title));
  }
});

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fileRoot = realpathSync(mkdtempSync(join(tmpdir(), "jotview-tool-")));
writeFileSync(join(fileRoot, "plan.md"), "# From a file\n\nbody\n");
writeFileSync(join(fileRoot, "untitled.md"), "no heading here\n");

test("no roots: path isn't offered and content stays required", () => {
  const { definition } = renderTool({});
  assert.equal("path" in definition.inputSchema.properties, false);
  assert.deepEqual(definition.inputSchema.required, ["content"]);
});

test("with roots: path is offered and content becomes optional", () => {
  const { definition } = renderTool({ roots: [fileRoot] });
  assert.equal(definition.inputSchema.properties.path.type, "string");
  assert.equal(definition.inputSchema.required, undefined);
});

test("path renders the file", async () => {
  const { t } = tool({ roots: [fileRoot] });
  const res = await t.call({ path: "plan.md" });
  assert.match(textOf(res).split("\n")[0], /^\[From a file\]\(https:\/\/jotbins\.com\/d#z:/);
});

test("a file with no heading is titled by its name", async () => {
  const { t } = tool({ roots: [fileRoot] });
  assert.match(textOf(await t.call({ path: "untitled.md" })).split("\n")[0], /^\[untitled\.md\]\(/);
});

test("path errors are tool errors; content and path are exclusive", async () => {
  const { t } = tool({ roots: [fileRoot] });
  for (const args of [{}, { path: "nope.md" }, { path: "/etc/hosts" }, { path: 3 }, { content: "# x", path: "plan.md" }]) {
    assert.equal((await t.call(args)).isError, true, JSON.stringify(args));
  }
});

test("without roots, path is rejected", async () => {
  const { t } = tool();
  assert.equal((await t.call({ path: "plan.md" })).isError, true);
});
