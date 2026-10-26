# Changelog

All notable changes to jotview. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added
- `read_link` and `decode` read public `jotbins.com/p` pastes, through the
  same query the site uses; private or expired pastes read as not found.

### Changed
- Tool description and server instructions tell agents that jotbins renders
  `$…$` / `$$…$$` math, `> [!NOTE]`-style callouts and `:emoji:` shortcodes.

## [0.5.0] - 2026-10-25

### Added
- `render_markdown` takes a `path` instead of `content` in the local server:
  `.md`/`.markdown`/`.mdx`/`.txt` files inside the server's working folder or
  an `--allow-dir` folder. Not offered when the server runs in `/` or your
  home folder, and never on the remote server.
- `jotview --json` prints `{url, rawUrl, shortened, permanent, failure}`.
- Claude Desktop bundle (`jotview.mcpb`) on each GitHub release, with an
  optional docs folder setting.
- MCP Registry entry `io.github.jotbins/jotview` (npm package + remote).
- CI on Node 18–24; releases publish from GitHub Actions (npm trusted
  publishing with provenance, GitHub release, MCP Registry).

## [0.4.1] - 2026-10-25

### Added
- `read_link` MCP tool: the markdown behind a `jotbins.com/d` or
  `surl.jotbins.com` link.
- `jotview decode <url>`.
- `title` input on `render_markdown`.
- The remote server's page at mcp.jotbins.com explains how to connect each
  AI client.

## [0.4.0] - 2026-10-25

### Added
- Remote MCP server at `https://mcp.jotbins.com/mcp` (Streamable HTTP, no
  sign-in), a Cloudflare Worker in `worker/`.

Published before the `read_link` work was merged; 0.4.1 carries it.

## [0.3.0] - 2026-10-24

### Added
- `jotview mcp`: stdio MCP server with `render_markdown`; serves MCP
  revisions 2024-11-05 through 2026-07-28. `--raw` forbids uploads.

## [0.2.0] - 2026-10-24

### Added
- `--keep` makes a short link permanent; notes say when short links expire.

## [0.1.0] - 2026-08-23

### Added
- Mint `jotbins.com/d` links from a file or stdin; shorten long links via
  surl.jotbins.com; `--raw`, `--short`, `--open`, `--copy`, `--base-url`.

[Unreleased]: https://github.com/jotbins/jotview/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/jotbins/jotview/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/jotbins/jotview/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/jotbins/jotview/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/jotbins/jotview/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/jotbins/jotview/releases/tag/v0.2.0
[0.1.0]: https://www.npmjs.com/package/jotview/v/0.1.0
