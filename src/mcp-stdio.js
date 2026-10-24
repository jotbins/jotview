import { createInterface } from "node:readline";
import { handleMessage, parseError } from "./mcp.js";

/**
 * Serve MCP over stdio: one JSON-RPC message per line in, one per line out.
 * Requests are handled concurrently — each response carries its own id.
 * Resolves once the client closes stdin and every pending reply is written.
 *
 * @param {{
 *   input: import("node:stream").Readable,
 *   write: (s: string) => void,
 *   ctx: import("./mcp.js").Context,
 * }} opts
 */
export async function serve({ input, write, ctx }) {
  /** @param {object|null} res */
  const send = (res) => {
    // JSON.stringify never emits a raw newline, so every message stays one line.
    if (res) write(`${JSON.stringify(res)}\n`);
  };

  /** @type {Promise<void>[]} */
  const pending = [];
  // readline reassembles messages split across chunks and splits chunks that
  // carry several messages.
  for await (const raw of createInterface({ input, crlfDelay: Infinity })) {
    const text = raw.trim();
    if (text === "") continue;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      send(parseError());
      continue;
    }
    pending.push(handleMessage(msg, ctx).then(send));
  }
  await Promise.all(pending);
}
