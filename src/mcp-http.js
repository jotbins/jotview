import { handleMessage, parseError, LEGACY_VERSIONS, MODERN_VERSIONS } from "./mcp.js";

/** Docs cap at 1 MB (MAX_DOC_BYTES); leave room for JSON escaping. */
export const MAX_BODY_BYTES = 2_000_000;

const KNOWN_VERSIONS = [...LEGACY_VERSIONS, ...MODERN_VERSIONS];

// No cookies or credentials are involved, so any origin may call — that lets
// browser-based clients such as MCP Inspector connect directly.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id",
  "access-control-max-age": "86400",
};

/** @param {unknown} body @param {number} [status] */
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

/** @param {string} text @param {number} status @param {Record<string,string>} [headers] */
const plain = (text, status, headers = {}) =>
  new Response(text, { status, headers: { ...CORS, "content-type": "text/plain; charset=utf-8", ...headers } });

/** @param {string} endpoint */
const landing = (endpoint) => `jotview — an MCP server that turns markdown into rendered jotbins links.

MCP endpoint (Streamable HTTP, no sign-in):
  ${endpoint}

claude.ai: Settings → Connectors → Add custom connector → paste the URL above.
Claude Code: claude mcp add -s user --transport http jotview ${endpoint}

Source: https://github.com/jotbins/jotview
`;

/**
 * Serve MCP over Streamable HTTP. Every request gets exactly one JSON reply —
 * no SSE stream and no sessions, since the only tool answers immediately.
 *
 * @param {Request} request
 * @param {import("./mcp.js").Context} ctx
 * @returns {Promise<Response>}
 */
export async function handleHttp(request, ctx) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (url.pathname === "/") {
    if (request.method !== "GET") return plain("Method not allowed\n", 405, { allow: "GET" });
    return plain(landing(`${url.origin}/mcp`), 200);
  }
  if (url.pathname !== "/mcp") return plain("Not found\n", 404);
  if (request.method !== "POST") return plain("Method not allowed\n", 405, { allow: "POST, OPTIONS" });

  const version = request.headers.get("mcp-protocol-version");
  if (version !== null && !KNOWN_VERSIONS.includes(version)) {
    return plain(`Unsupported MCP-Protocol-Version: ${version}\n`, 400);
  }

  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES) return plain("Request too large\n", 413);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) return plain("Request too large\n", 413);

  let msg;
  try {
    msg = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json(parseError(), 400);
  }

  const reply = await handleMessage(msg, ctx);
  return reply ? json(reply) : new Response(null, { status: 202, headers: CORS });
}
