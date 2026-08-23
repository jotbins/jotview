# jotview

Turn a markdown file into a [jotbins](https://jotbins.com) link that renders it.

```bash
npx jotview notes.md
# https://jotbins.com/d#z:U1bwSM3JyecCAA
```

Zero dependencies. No install, no account, no config.

## How it works

The document is compressed and packed into the URL's **fragment** — the part
after `#`. Fragments are never sent to a server, so for links under 2000
characters nothing you write leaves your machine. Opening the link renders it
entirely in the browser.

## Usage

```
jotview <file>            mint a link from a file
jotview                   read markdown from stdin

  --raw                   never shorten; always the full /d URL
  --short                 always shorten, even when small
  --open                  open the link in your browser
  --copy                  copy the link to your clipboard
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
```

## Shortening, and what it costs you

A document's link grows with the document — roughly half the markdown's size in
characters. A 20 KB file produces an ~8,700-character URL, which Discord, X, and
most chat clients will not accept.

So links over **2000 characters are shortened** via `surl.jotbins.com`, and
jotview tells you on stderr when that happens:

```
note: uploaded to jotbins to shorten (8768 → 30 chars). use --raw to keep it local.
```

**Shortening uploads your document.** The fragment *is* the markdown, so storing
the URL stores the text. Below the threshold nothing is uploaded and no network
request is made at all. Use `--raw` to keep a long document local, accepting a
URL too long to paste into most places.

If the shortener is unreachable or rate-limited, jotview prints the full link
and exits 0 — it never fails your pipeline over a shortening problem.

## Output contract

**stdout is the URL and nothing else.** Notices, warnings, and errors go to
stderr, so `$(jotview x.md)` and `jotview x.md | pbcopy` stay clean.

Exit codes: `0` success, `1` runtime error, `2` usage error.

## Limits

Input is capped at 1 MB, matching what the `/d` renderer will open.

## Requirements

Node 18 or newer.

## License

MIT
