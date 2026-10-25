/**
 * MCP message handling — pure, no I/O. `mcp-stdio.js` owns the transport.
 *
 * jotview is a dual-era server. Clients on the handshake revisions open with
 * `initialize`; clients on 2026-07-28 open with `server/discover` and put the
 * protocol version in every request's `_meta`. The tools are stateless, so
 * both eras are served from the same handlers and only the envelope differs.
 */

/** Newest first: `initialize` answers with the first one the client lacks. */
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const MODERN_VERSIONS = ["2026-07-28"];

export const INSTRUCTIONS =
  "Use render_markdown to share markdown — including Mermaid diagrams — as a " +
  "rendered jotbins page. Show the returned link to the user as a markdown " +
  "link, [title](url); never paste a bare jotbins.com/d URL, it can be " +
  "thousands of characters. Long documents are uploaded to shorten the link " +
  'unless the user asked to keep them local (shorten: "never"). Use read_link ' +
  "to get the markdown behind a jotbins link the user shares.";

const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const UNSUPPORTED_VERSION = -32022;

/**
 * @typedef {object} Tool
 * @property {{name: string} & Record<string, unknown>} definition  as listed by tools/list
 * @property {(args: Record<string, unknown>) => Promise<object>} call  returns a CallToolResult
 */

/**
 * @typedef {object} Context
 * @property {string} version  jotview's own version, reported as serverInfo
 * @property {Tool[]} tools
 */

/**
 * @param {string|number|null} id
 * @param {number} code
 * @param {string} message
 * @param {unknown} [data]
 */
export function errorResponse(id, code, message, data) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined && { data }) } };
}

/** For the transport: a line that wasn't JSON at all. */
export const parseError = () => errorResponse(null, PARSE_ERROR, "Parse error");

/** @param {Context} ctx */
const serverInfo = (ctx) => ({ name: "jotview", version: ctx.version });

/**
 * Handle one parsed JSON-RPC message.
 * @param {unknown} msg
 * @param {Context} ctx
 * @returns {Promise<object|null>} the response, or null when none is owed
 */
export async function handleMessage(msg, ctx) {
  if (Array.isArray(msg)) {
    return errorResponse(null, INVALID_REQUEST, "Batches are not supported");
  }
  if (msg === null || typeof msg !== "object") {
    return errorResponse(null, INVALID_REQUEST, "Invalid request");
  }

  const m = /** @type {Record<string, any>} */ (msg);
  const hasId = "id" in m;
  const id = hasId ? m.id : null;

  // A response to something we sent. jotview never sends requests, so there
  // is nothing to match it against.
  if (typeof m.method !== "string" && hasId && ("result" in m || "error" in m)) return null;
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") {
    return hasId ? errorResponse(id, INVALID_REQUEST, "Invalid request") : null;
  }
  if (!hasId) return null; // notifications never get a reply

  const params = m.params && typeof m.params === "object" ? m.params : {};
  const meta = params._meta && typeof params._meta === "object" ? params._meta : {};
  const modern = META_VERSION in meta;

  if (modern) {
    const requested = meta[META_VERSION];
    if (!MODERN_VERSIONS.includes(requested)) {
      return errorResponse(id, UNSUPPORTED_VERSION, "Unsupported protocol version", {
        supported: MODERN_VERSIONS,
        requested,
      });
    }
    if (m.method !== "server/discover" && !(META_CAPABILITIES in meta)) {
      return errorResponse(id, INVALID_PARAMS, `Missing _meta["${META_CAPABILITIES}"]`);
    }
  }

  /** @param {object} result */
  const ok = (result) => ({
    jsonrpc: "2.0",
    id,
    result: modern ? { resultType: "complete", ...result } : result,
  });

  switch (m.method) {
    case "initialize": {
      const asked = params.protocolVersion;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: LEGACY_VERSIONS.includes(asked) ? asked : LEGACY_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: serverInfo(ctx),
          instructions: INSTRUCTIONS,
        },
      };
    }

    case "server/discover":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          resultType: "complete",
          supportedVersions: MODERN_VERSIONS,
          capabilities: { tools: {} },
          _meta: { "io.modelcontextprotocol/serverInfo": serverInfo(ctx) },
          instructions: INSTRUCTIONS,
          ttlMs: 60 * 60 * 1000,
          cacheScope: "public",
        },
      };

    case "ping":
      return ok({});

    case "tools/list":
      return ok({ tools: ctx.tools.map((t) => t.definition) });

    case "tools/call": {
      const tool = ctx.tools.find((t) => t.definition.name === params.name);
      if (!tool) return errorResponse(id, INVALID_PARAMS, `Unknown tool: ${params.name}`);
      const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
      try {
        return ok(await tool.call(args));
      } catch (err) {
        return errorResponse(id, INTERNAL_ERROR, /** @type {Error} */ (err).message);
      }
    }

    default:
      return errorResponse(id, METHOD_NOT_FOUND, `Method not found: ${m.method}`);
  }
}
