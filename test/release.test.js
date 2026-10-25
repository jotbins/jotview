import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderTool } from "../src/mcp-tool.js";
import { readTool } from "../src/mcp-read-tool.js";

const read = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const pkg = read("package.json");
const manifest = read("manifest.json");
const server = read("server.json");

test("bundle manifest and registry entry carry the package version", () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(server.version, pkg.version);
  for (const p of server.packages) assert.equal(p.version, pkg.version);
});

test("registry name matches package.json mcpName (npm ownership check)", () => {
  assert.equal(server.name, pkg.mcpName);
  assert.equal(server.packages[0].identifier, pkg.name);
});

test("registry description fits the 100-character limit", () => {
  assert.ok(server.description.length <= 100, `${server.description.length} chars`);
});

test("the bundle manifest lists the server's actual tools", () => {
  const names = [renderTool({}), readTool({})].map((t) => t.definition.name);
  assert.deepEqual(manifest.tools.map((t) => t.name), names);
});
