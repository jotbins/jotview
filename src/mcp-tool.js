import { mint } from "./mint.js";
import { shorten, DEFAULT_BASE_URL, SHORTENER_URL } from "./shorten.js";
import { JotviewError } from "./codec.js";

/** Every character of a /d link costs the user tokens twice — once handed
 *  back to the model, once written into its reply — so MCP shortens much
 *  sooner than the CLI's 2000. */
export const MCP_SHORTEN_THRESHOLD = 500;

const SHORTENER_HOST = new URL(SHORTENER_URL).host;
const TITLE_MAX = 80;
const MODES = ["auto", "always", "never"];

const DEFINITION = {
  name: "render_markdown",
  title: "Render markdown with jotbins",
  description:
    "Turn markdown (GitHub-flavored, with ```mermaid diagrams) into a link that " +
    "renders it as a page on jotbins.com. Returns a ready-made markdown link to " +
    "show the user. Small documents live entirely in the link; larger ones are " +
    "uploaded to surl.jotbins.com for a short link that expires after 30 days " +
    "unused unless keep is true.",
  inputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "The markdown to render." },
      keep: {
        type: "boolean",
        description: "Make a shortened link permanent instead of expiring after 30 days unused.",
      },
      title: {
        type: "string",
        description: "Link text to show instead of the document's first heading.",
      },
      shorten: {
        type: "string",
        enum: MODES,
        description:
          'Default "auto" shortens long links. "never" keeps the document out of ' +
          'any upload (long link); "always" shortens even small ones.',
      },
    },
    required: ["content"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
};

/**
 * The first markdown heading, as safe link text.
 * @param {string} md
 */
export function docTitle(md) {
  const match = md.match(/^#{1,6}[ \t]+(.+?)[ \t#]*$/m);
  return linkText(match ? match[1] : "jotbins doc");
}

/** @param {string} text */
const linkText = (text) => text.trim().slice(0, TITLE_MAX).replace(/[\\[\]]/g, (c) => `\\${c}`);

/** @param {string} text */
const toolError = (text) => ({ content: [{ type: "text", text }], isError: true });

/**
 * @param {Record<string, unknown>} args
 * @returns {string|null} what's wrong, phrased for the model to fix
 */
function validate(args) {
  if (typeof args.content !== "string") return "content is required: pass the markdown to render as a string.";
  if (args.content.trim() === "") return "content is empty: pass the markdown to render.";
  if (args.keep !== undefined && typeof args.keep !== "boolean") return "keep must be true or false.";
  if (args.title !== undefined && (typeof args.title !== "string" || args.title.trim() === "")) {
    return "title must be a non-empty string, or left out to use the first heading.";
  }
  if (args.shorten !== undefined && !MODES.includes(/** @type {string} */ (args.shorten))) {
    return 'shorten must be "auto", "always" or "never".';
  }
  return null;
}

/**
 * @param {import("./mint.js").MintResult} r
 * @param {boolean} keepAsked
 */
function describe(r, keepAsked) {
  if (r.shortened) {
    return r.permanent
      ? `Short link: the document was uploaded to ${SHORTENER_HOST} and the link is permanent.`
      : `Short link: the document was uploaded to ${SHORTENER_HOST}. It is deleted after 30 days ` +
          "without a visit; call again with keep: true for a permanent link.";
  }
  const notes = [];
  if (r.skipped === "uploads-off") {
    notes.push("Full link: uploads are turned off for this server, so it was not shortened. Nothing was uploaded.");
  } else if (r.skipped === "custom-base") {
    notes.push(`Full link: only ${DEFAULT_BASE_URL} links can be shortened. Nothing was uploaded.`);
  } else if (r.failure) {
    notes.push(
      `Full link: shortening failed (${r.failure}). The document may still have reached ${SHORTENER_HOST}.`,
    );
  } else {
    notes.push("Full link: the document lives in the link itself; nothing was uploaded and it never expires.");
  }
  if (keepAsked) notes.push("keep has no effect here: full links never expire.");
  return notes.join(" ");
}

/**
 * @param {{
 *   allowUpload?: boolean,
 *   baseUrl?: string,
 *   shortenImpl?: typeof shorten,
 * }} opts  `allowUpload: false` is `jotview mcp --raw`
 * @returns {import("./mcp.js").Tool}
 */
export function renderTool(opts) {
  return {
    definition: DEFINITION,
    async call(args) {
      const problem = validate(args);
      if (problem) return toolError(problem);

      const md = /** @type {string} */ (args.content);
      const keep = args.keep === true;
      let r;
      try {
        r = await mint(md, {
          baseUrl: opts.baseUrl,
          shorten: /** @type {import("./mint.js").ShortenMode} */ (args.shorten ?? "auto"),
          keep,
          allowUpload: opts.allowUpload ?? true,
          threshold: MCP_SHORTEN_THRESHOLD,
          shortenImpl: opts.shortenImpl ?? shorten,
        });
      } catch (err) {
        if (err instanceof JotviewError) return toolError(`${err.message}. Shorten or split the document.`);
        throw err;
      }

      const text =
        `[${typeof args.title === "string" ? linkText(args.title) : docTitle(md)}](${r.url})\n\n` +
        `${describe(r, keep && !r.shortened)}\n` +
        "Show it to the user as the markdown link above, not as a bare URL.";
      return { content: [{ type: "text", text }] };
    },
  };
}
