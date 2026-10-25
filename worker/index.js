import { handleHttp } from "../src/mcp-http.js";
import { renderTool } from "../src/mcp-tool.js";
import { readTool } from "../src/mcp-read-tool.js";
import { surlShortener } from "./shortener.js";
import pkg from "../package.json" with { type: "json" };

export default {
  /** @param {Request} request @param {Record<string, any>} env */
  fetch(request, env) {
    const client = request.headers.get("cf-connecting-ip") ?? "unknown";
    const surlFetch = env.SURL ? (input, init) => env.SURL.fetch(input, init) : undefined;
    return handleHttp(request, {
      version: pkg.version,
      tools: [
        renderTool({ shortenImpl: surlShortener(env, client) }),
        readTool({ fetchImpl: surlFetch }),
      ],
    });
  },
};
