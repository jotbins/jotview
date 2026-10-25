# jotview

Turn a markdown file into a [jotbins](https://jotbins.com) link that renders it.

```bash
npx jotview notes.md
# https://jotbins.com/d#z:U1bwSM3JyecCAA
```

Zero dependencies. No install, no account, no config.

## How it works

The document is compressed and packed into the URL's **fragment** — the part
after `#`. Fragments are never sent to a server, so for links 2000 characters
or fewer nothing you write leaves your machine. Opening the link renders it
entirely in the browser.

## Usage

```
jotview <file>            mint a link from a file
jotview                   read markdown from stdin
jotview decode <url>      print the markdown behind a /d or short link
jotview mcp [--raw]       run as an MCP server for AI agents

  --raw                   never shorten; always the full /d URL
  --short                 always shorten, even when small
  --keep                  make a shortened link permanent
  --open                  open the link in your browser
  --copy                  copy the link to your clipboard
  --json                  print the result as one JSON line (see below)
  --base-url <url>        override https://jotbins.com
  -h, --help
  -v, --version
```

Examples:

```bash
jotview README.md --open
cat notes.md | jotview
jotview notes.md | pbcopy
LINK=$(jotview notes.md --raw)
jotview decode https://surl.jotbins.com/abc123 > notes.md
```

`decode` accepts `jotbins.com/d` links (decoded locally) and
`surl.jotbins.com` short links (fetched; like a click, that keeps an active
short link alive).

## Shortening, and what it costs you

A document's link grows with the document — roughly half the markdown's size in
characters. A 20 KB file produces an ~8,700-character URL, which Discord, X, and
most chat clients will not accept.

So links over **2000 characters are shortened** via `surl.jotbins.com`, and
jotview tells you on stderr when that happens:

```
note: uploaded to jotbins to shorten (8768 → 30 chars). use --raw to keep it local.
note: short link expires after 30 days unused. use --keep to keep it forever.
```

**Shortening uploads your document.** The fragment *is* the markdown, so storing
the URL stores the text. Below the threshold nothing is uploaded and no network
request is made at all. Use `--raw` to keep a long document local, accepting a
URL too long to paste into most places.

**Short links clean up after themselves.** One nobody opens for 30 days is
deleted, with a 60-day window to bring it back from its waiting page. Pass
`--keep` to make it permanent from the start, or click **Save link** on the
waiting page any time before then. Full `/d` links are never stored, so they
never expire.

If the shortener is unreachable or rate-limited, jotview prints the full link
and exits 0 — it never fails your pipeline over a shortening problem.

## Use with AI agents (MCP)

`jotview mcp` is a stdio [MCP](https://modelcontextprotocol.io) server with two
tools. With `render_markdown` an AI writes markdown — notes, a report, a
Mermaid diagram — and gets back a jotbins link to hand you; with `read_link`
it reads a jotbins link you share.

**Claude Code**

```bash
claude mcp add jotview -- npx -y jotview mcp
```

**Claude Desktop, Cursor, and other clients** — add to the MCP config:

```json
{ "mcpServers": { "jotview": { "command": "npx", "args": ["-y", "jotview", "mcp"] } } }
```

Then just ask: *"draw a diagram of our deploy flow and give me a jotbins link."*

**`render_markdown`** takes `content` (the markdown), plus optional `title`
(link text instead of the first heading), `keep` (make a short link
permanent) and `shorten` (`"auto"`, `"always"` or `"never"`). It returns a
ready-made markdown link, `[First heading](url)`, and a note on whether
anything was uploaded. It never reads files — the AI passes text it already
has.

**Rendering files.** The local server can also take a `path` instead of
`content`, so the AI doesn't have to paste a whole file into the tool call.
It reads only `.md`, `.markdown`, `.mdx` and `.txt` files, and only inside
the folder the server runs in (Claude Code starts it in your project) or a
folder you allow with `--allow-dir`:

```bash
claude mcp add -s user jotview -- npx -y jotview mcp --allow-dir ~/notes
```

If the server runs in `/` or your home folder and no `--allow-dir` is given,
`path` is switched off. The remote server never reads files.

**`read_link`** takes a `url` (a `/d` link or a short link) and returns the
markdown behind it, so you can paste a link and say *"fix the typos and give
me a new link."* Links never change; an edit is a new link.

**Uploads.** Every character of a link costs tokens, so MCP shortens sooner
than the CLI: links over **500** characters go through `surl.jotbins.com`,
which uploads the document (short links expire after 30 days unused unless
`keep` is set). To forbid uploads entirely, start the server with `--raw`:

```bash
claude mcp add jotview -- npx -y jotview mcp --raw
```

Works with clients on any MCP revision from `2024-11-05` through `2026-07-28`.

### Remote server — no install

The same tool runs at **`https://mcp.jotbins.com/mcp`** (Streamable HTTP, no
sign-in), for clients that can't run local commands.

- **claude.ai (web and mobile):** Settings → Connectors → Add custom
  connector → paste `https://mcp.jotbins.com/mcp`.
- **Claude Code:** `claude mcp add -s user --transport http jotview https://mcp.jotbins.com/mcp`

Same rules as the local server, except it can't forbid uploads: use
`shorten: "never"` per call, or the local `--raw` server, to keep a document
off `surl.jotbins.com`. Uploads are rate-limited per client; over the limit
you still get the full link.

The Worker lives in [`worker/`](worker/) and deploys with
`cd worker && npx wrangler deploy`.

## Output contract

**stdout is the URL and nothing else.** Notices, warnings, and errors go to
stderr, so `$(jotview x.md)` and `jotview x.md | pbcopy` stay clean.

With `--json`, stdout is one JSON line instead, for scripts and CI:

```json
{"url":"https://surl.jotbins.com/abc123","rawUrl":"https://jotbins.com/d#z:…","shortened":true,"permanent":false,"failure":null}
```

`failure` is the shortener's error when shortening was tried and failed
(`url` is then the full link).

Exit codes: `0` success, `1` runtime error, `2` usage error.

## Limits

Input is capped at 1 MB, matching what the `/d` renderer will open.

## Requirements

Node 18 or newer.

## License

MIT
