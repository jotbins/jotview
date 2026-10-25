import { readLink } from "./read.js";
import { JotviewError } from "./codec.js";

const DEFINITION = {
  name: "read_link",
  title: "Read a jotbins link",
  description:
    "Get the markdown behind a jotbins link — a jotbins.com/d link or a " +
    "surl.jotbins.com short link — so you can read, quote or edit it. Links " +
    "never change: to edit, change the markdown and call render_markdown for " +
    "a new link. Reading a short link counts as a visit and keeps it alive.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The jotbins.com/d or surl.jotbins.com link." },
    },
    required: ["url"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
};

/** @param {string} text */
const toolError = (text) => ({ content: [{ type: "text", text }], isError: true });

/**
 * @param {{fetchImpl?: typeof fetch}} opts  the Worker passes its surl binding
 * @returns {import("./mcp.js").Tool}
 */
export function readTool(opts) {
  return {
    definition: DEFINITION,
    async call(args) {
      if (typeof args.url !== "string" || args.url.trim() === "") {
        return toolError("url is required: pass the jotbins link to read.");
      }
      try {
        const { markdown } = await readLink(args.url, { fetchImpl: opts.fetchImpl });
        return { content: [{ type: "text", text: markdown }] };
      } catch (err) {
        if (err instanceof JotviewError) return toolError(`Can't read that link: ${err.message}`);
        throw err;
      }
    },
  };
}
