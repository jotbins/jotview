import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";

const LONG = "# Big doc\n\n" + Array.from({ length: 60 }, (_, i) => `## Section ${i} text ${i * 7919}\n`).join("");

/** A fake Worker env: a surl service binding and an upload limiter. */
function fakeEnv({ allow = true } = {}) {
  const surlCalls = [];
  const limitKeys = [];
  return {
    surlCalls,
    limitKeys,
    SURL: {
      fetch: async (input, init) => {
        surlCalls.push({ input, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ short_url: "https://surl.jotbins.com/abc123" }));
      },
    },
    UPLOADS: { limit: async ({ key }) => { limitKeys.push(key); return { success: allow }; } },
  };
}

/** @param {string} content @param {object} env */
async function render(content, env) {
  const res = await worker.fetch(new Request("https://mcp.jotbins.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "render_markdown", arguments: { content } } }),
  }), env);
  return (await res.json()).result.content[0].text;
}

test("a long doc is shortened through the SURL service binding", async () => {
  const env = fakeEnv();
  const text = await render(LONG, env);
  assert.equal(env.surlCalls.length, 1);
  assert.equal(env.surlCalls[0].input, "https://surl.jotbins.com/api/create");
  assert.match(text, /^\[Big doc\]\(https:\/\/surl\.jotbins\.com\/abc123\)/);
});

test("uploads are rate-limited per client IP", async () => {
  const env = fakeEnv();
  await render(LONG, env);
  assert.deepEqual(env.limitKeys, ["203.0.113.7"]);
});

test("over the limit, the tool still answers with the full link", async () => {
  const env = fakeEnv({ allow: false });
  const text = await render(LONG, env);
  assert.equal(env.surlCalls.length, 0);
  assert.match(text, /^\[Big doc\]\(https:\/\/jotbins\.com\/d#z:/);
  assert.match(text, /upload limit/);
});

test("a small doc never touches surl or the limiter", async () => {
  const env = fakeEnv();
  const text = await render("# Hi\n\nthere", env);
  assert.equal(env.surlCalls.length, 0);
  assert.equal(env.limitKeys.length, 0);
  assert.match(text, /^\[Hi\]\(https:\/\/jotbins\.com\/d#z:/);
});

test("serverInfo carries the package version", async () => {
  const res = await worker.fetch(new Request("https://mcp.jotbins.com/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {} } }),
  }), fakeEnv());
  const { version } = await import("../package.json", { with: { type: "json" } }).then((m) => m.default);
  assert.equal((await res.json()).result.serverInfo.version, version);
});
