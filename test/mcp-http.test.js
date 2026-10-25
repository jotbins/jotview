import { test } from "node:test";
import assert from "node:assert/strict";
import { handleHttp, MAX_BODY_BYTES } from "../src/mcp-http.js";

const ctx = {
  version: "9.9.9",
  tools: [{
    definition: { name: "echo", inputSchema: { type: "object" } },
    call: async (args) => ({ content: [{ type: "text", text: String(args.text) }] }),
  }],
};

const BASE = "https://mcp.jotbins.com";

/** @param {object|string} body @param {Record<string,string>} [headers] */
function post(body, headers = {}, path = "/mcp") {
  return handleHttp(new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), ctx);
}

test("POST initialize returns one JSON reply", async () => {
  const res = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^application\/json/);
  const body = await res.json();
  assert.equal(body.id, 1);
  assert.equal(body.result.protocolVersion, "2025-06-18");
  assert.equal(body.result.serverInfo.version, "9.9.9");
});

test("POST tools/call runs the tool", async () => {
  const res = await post({ jsonrpc: "2.0", id: "c", method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } });
  assert.equal((await res.json()).result.content[0].text, "hi");
});

test("a notification gets 202 and no body", async () => {
  const res = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(res.status, 202);
  assert.equal(await res.text(), "");
});

test("invalid JSON is a 400 parse error", async () => {
  const res = await post("{nope");
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, -32700);
});

test("an unknown MCP-Protocol-Version header is a 400", async () => {
  const res = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "mcp-protocol-version": "1999-01-01" });
  assert.equal(res.status, 400);
});

test("a known MCP-Protocol-Version header is accepted", async () => {
  const res = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "mcp-protocol-version": "2025-06-18" });
  assert.equal(res.status, 200);
});

test("an oversized body is a 413", async () => {
  const res = await post("x".repeat(MAX_BODY_BYTES + 1));
  assert.equal(res.status, 413);
});

test("GET and DELETE on /mcp are 405 — no SSE stream, no sessions", async () => {
  for (const method of ["GET", "DELETE"]) {
    const res = await handleHttp(new Request(`${BASE}/mcp`, { method }), ctx);
    assert.equal(res.status, 405, method);
    assert.match(res.headers.get("allow"), /POST/);
  }
});

test("OPTIONS answers CORS preflight", async () => {
  const res = await handleHttp(new Request(`${BASE}/mcp`, { method: "OPTIONS" }), ctx);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match(res.headers.get("access-control-allow-headers"), /mcp-protocol-version/i);
});

test("replies carry CORS headers", async () => {
  const res = await post({ jsonrpc: "2.0", id: 1, method: "ping" });
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("GET / explains how to connect", async () => {
  const res = await handleHttp(new Request(`${BASE}/`), ctx);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /https:\/\/mcp\.jotbins\.com\/mcp/);
});

test("anything else is a 404", async () => {
  const res = await handleHttp(new Request(`${BASE}/nope`), ctx);
  assert.equal(res.status, 404);
});
