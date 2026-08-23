#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { run } from "../src/cli.js";

const MIN_MAJOR = 18;
const major = Number(process.versions.node.split(".")[0]);
if (major < MIN_MAJOR) {
  process.stderr.write(
    `jotview requires Node ${MIN_MAJOR} or newer (found ${process.versions.node}).\n`,
  );
  process.exit(1);
}

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

// A downstream reader that exits early (`| head`, `| less` then `q`) closes
// its end of the pipe. If the URL is still being flushed when that happens,
// Node's default behavior is to throw on the stream's next write, crashing
// the process after the URL was already delivered successfully. Treat EPIPE
// as the benign "reader stopped listening" signal it is.
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

process.exitCode = await run(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  stdin: process.stdin,
  isTTY: Boolean(process.stdin.isTTY),
  version,
});
