import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMessage, LEGACY_VERSIONS, MODERN_VERSIONS } from "../src/mcp.js";

const echoTool = {
  definition: { name: "echo", description: "echo", inputSchema: { type: "object" } },
  call: async (args) => ({ content: [{ type: "text", text: JSON.stringify(args) }] }),
};
const ctx = { version: "9.9.9", tools: [echoTool] };

const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
};

const req = (id, method, params) => ({ jsonrpc: "2.0", id, method, ...(params && { params }) });

test("legacy initialize echoes a supported version", async () => {
  const res = await handleMessage(
    req(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } }),
    ctx,
  );
  assert.equal(res.id, 1);
  assert.equal(res.result.protocolVersion, "2025-06-18");
  assert.deepEqual(res.result.serverInfo, { name: "jotview", version: "9.9.9" });
  assert.ok(res.result.capabilities.tools);
  assert.match(res.result.instructions, /render_markdown/);
  assert.equal("resultType" in res.result, false);
});

test("legacy initialize with an unknown version answers the newest legacy one", async () => {
  const res = await handleMessage(req(1, "initialize", { protocolVersion: "1999-01-01" }), ctx);
  assert.equal(res.result.protocolVersion, LEGACY_VERSIONS[0]);
  assert.equal(LEGACY_VERSIONS[0], "2025-11-25");
});

test("notifications get no response", async () => {
  assert.equal(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx), null);
  assert.equal(await handleMessage({ jsonrpc: "2.0", method: "notifications/whatever" }, ctx), null);
});

test("responses sent to us are ignored", async () => {
  assert.equal(await handleMessage({ jsonrpc: "2.0", id: 5, result: {} }, ctx), null);
});

test("server/discover describes the server for modern clients", async () => {
  const res = await handleMessage(req("d1", "server/discover", { _meta: MODERN_META }), ctx);
  assert.equal(res.id, "d1");
  assert.equal(res.result.resultType, "complete");
  assert.deepEqual(res.result.supportedVersions, MODERN_VERSIONS);
  assert.deepEqual(res.result._meta["io.modelcontextprotocol/serverInfo"], { name: "jotview", version: "9.9.9" });
  assert.ok(res.result.capabilities.tools);
  assert.equal(typeof res.result.ttlMs, "number");
});

test("server/discover works without _meta", async () => {
  const res = await handleMessage(req(2, "server/discover"), ctx);
  assert.equal(res.result.resultType, "complete");
});

test("modern request with an unsupported version gets -32022", async () => {
  const res = await handleMessage(
    req(3, "tools/list", { _meta: { ...MODERN_META, "io.modelcontextprotocol/protocolVersion": "2099-01-01" } }),
    ctx,
  );
  assert.equal(res.error.code, -32022);
  assert.deepEqual(res.error.data, { supported: MODERN_VERSIONS, requested: "2099-01-01" });
});

test("modern request missing clientCapabilities gets -32602", async () => {
  const res = await handleMessage(
    req(4, "tools/list", { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } }),
    ctx,
  );
  assert.equal(res.error.code, -32602);
});

test("tools/list lists the tools; modern adds resultType", async () => {
  const legacy = await handleMessage(req(5, "tools/list"), ctx);
  assert.deepEqual(legacy.result, { tools: [echoTool.definition] });

  const modern = await handleMessage(req(6, "tools/list", { _meta: MODERN_META }), ctx);
  assert.equal(modern.result.resultType, "complete");
  assert.deepEqual(modern.result.tools, [echoTool.definition]);
});

test("tools/call runs the tool with its arguments", async () => {
  const legacy = await handleMessage(req(7, "tools/call", { name: "echo", arguments: { a: 1 } }), ctx);
  assert.deepEqual(legacy.result, { content: [{ type: "text", text: '{"a":1}' }] });

  const modern = await handleMessage(
    req(8, "tools/call", { name: "echo", arguments: {}, _meta: MODERN_META }),
    ctx,
  );
  assert.equal(modern.result.resultType, "complete");
});

test("tools/call with an unknown tool gets -32602", async () => {
  const res = await handleMessage(req(9, "tools/call", { name: "nope", arguments: {} }), ctx);
  assert.equal(res.error.code, -32602);
  assert.match(res.error.message, /nope/);
});

test("a tool that throws becomes -32603, not a crash", async () => {
  const boom = { definition: { name: "boom" }, call: async () => { throw new Error("kaput"); } };
  const res = await handleMessage(req(10, "tools/call", { name: "boom" }), { ...ctx, tools: [boom] });
  assert.equal(res.error.code, -32603);
});

test("ping answers empty", async () => {
  assert.deepEqual((await handleMessage(req(11, "ping"), ctx)).result, {});
});

test("unknown methods get -32601", async () => {
  const res = await handleMessage(req(12, "resources/list"), ctx);
  assert.equal(res.error.code, -32601);
});

test("batches and malformed messages get -32600", async () => {
  const batch = await handleMessage([req(1, "ping")], ctx);
  assert.equal(batch.error.code, -32600);
  assert.equal(batch.id, null);

  const noVersion = await handleMessage({ id: 3, method: "ping" }, ctx);
  assert.equal(noVersion.error.code, -32600);
  assert.equal(noVersion.id, 3);

  const notObject = await handleMessage("hello", ctx);
  assert.equal(notObject.error.code, -32600);
});
