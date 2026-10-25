/**
 * The page a person sees opening the MCP server in a browser: what it is and
 * how to connect it to each common AI tool. Plain text, 80 columns.
 * @param {string} endpoint  e.g. https://mcp.jotbins.com/mcp
 */
export const landingText = (endpoint) => `jotview MCP — rendered jotbins links from any AI tool
=====================================================

Connect this server and your AI gets one tool, render_markdown. Ask it for
notes, a report or a Mermaid diagram "as a jotbins link" and it hands back a
link that opens the page, fully rendered, on jotbins.com.

  Endpoint:  ${endpoint}
  Transport: Streamable HTTP. No sign-in, no API key.


CONNECT IT
----------

claude.ai, Claude Desktop and the Claude mobile apps
  1. Settings → Connectors → Add custom connector.
  2. Name it jotview and paste the endpoint URL above.
  3. In a chat, make sure jotview is switched on in the tools menu.
  Connectors added on the web also show up on mobile. Custom connectors may
  need a paid Claude plan; on Team and Enterprise an owner adds them.

Claude Code
  claude mcp add -s user --transport http jotview ${endpoint}

Cursor — ~/.cursor/mcp.json
  {
    "mcpServers": {
      "jotview": { "url": "${endpoint}" }
    }
  }

VS Code (Copilot agent mode) — .vscode/mcp.json
  {
    "servers": {
      "jotview": { "type": "http", "url": "${endpoint}" }
    }
  }

Windsurf — ~/.codeium/windsurf/mcp_config.json
  {
    "mcpServers": {
      "jotview": { "serverUrl": "${endpoint}" }
    }
  }

Gemini CLI — ~/.gemini/settings.json
  {
    "mcpServers": {
      "jotview": { "httpUrl": "${endpoint}" }
    }
  }

Anything else
  Add a remote MCP server with the endpoint URL. If your tool can only run
  local servers, use the npm package instead (needs Node 18+):
    npx -y jotview mcp


TRY IT
------

  "Write up our deploy checklist and give me a jotbins link."
  "Draw the login flow as a Mermaid sequence diagram, as a jotbins link."

The AI answers with a link named after the document's first heading.


WHAT HAPPENS TO YOUR DOCUMENT
-----------------------------

Small documents live entirely inside the link, after the #. They never reach
a server and never expire.

Larger ones (a link over 500 characters) are uploaded to surl.jotbins.com
for a short link. Short links are deleted after 30 days without a visit.
Ask the AI to "keep" the link to make it permanent, or "don't upload" to
always get the full link.


Source, CLI and docs: https://github.com/jotbins/jotview
`;
