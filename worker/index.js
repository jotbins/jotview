import { handleHttp } from "../src/mcp-http.js";
import { renderTool } from "../src/mcp-tool.js";
import { surlShortener } from "./shortener.js";
import pkg from "../package.json" with { type: "json" };

export default {
  /** @param {Request} request @param {Record<string, any>} env */
  fetch(request, env) {
    const client = request.headers.get("cf-connecting-ip") ?? "unknown";
    return handleHttp(request, {
      version: pkg.version,
      tools: [renderTool({ shortenImpl: surlShortener(env, client) })],
    });
  },
};
