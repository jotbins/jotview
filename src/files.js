import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, isAbsolute, parse, resolve, sep } from "node:path";
import { JotviewError, MAX_DOC_BYTES } from "./codec.js";

/** The only files the MCP `path` input reads: a prompt-injected model must
 *  not be able to render (and upload) keys, .env files and the like. */
export const READABLE_EXTENSIONS = [".md", ".markdown", ".mdx", ".txt"];

/** @param {string} p */
const isFilesystemRoot = (p) => parse(p).root === p;

/** @param {string} dir */
function realDir(dir) {
  try {
    const real = realpathSync(dir);
    if (statSync(real).isDirectory()) return real;
  } catch {
    // fall through
  }
  throw new JotviewError("usage", `--allow-dir: not a folder: ${dir}`);
}

/**
 * Folders the MCP server may read from: its working folder (Claude Code
 * starts it in the project) unless that is `/` or the home folder, plus any
 * `--allow-dir`. Blank values and unfilled `${…}` placeholders (an unset
 * Desktop bundle setting) are ignored.
 *
 * @param {{cwd: string, extra?: string[], home?: string}} opts
 * @returns {string[]} real paths, deduplicated
 */
export function allowedRoots({ cwd, extra = [], home = homedir() }) {
  const roots = [];
  const realCwd = realpathSync(cwd);
  let realHome = home;
  try { realHome = realpathSync(home); } catch { /* keep as given */ }
  if (!isFilesystemRoot(realCwd) && realCwd !== realHome) roots.push(realCwd);
  for (const dir of extra) {
    if (dir.trim() === "" || dir.startsWith("${")) continue;
    roots.push(realDir(resolve(cwd, dir)));
  }
  return [...new Set(roots)];
}

/** @param {string} p */
const readable = (p) => READABLE_EXTENSIONS.includes(extname(p).toLowerCase());

/**
 * Read a markdown or text file inside one of `roots`. Relative paths resolve
 * against the first root. Symlinks are resolved before the checks.
 *
 * @param {string} path
 * @param {string[]} roots  from allowedRoots
 * @returns {string}
 */
export function readAllowedFile(path, roots) {
  if (roots.length === 0) {
    throw new JotviewError("not-allowed", "file access is off for this server; pass the markdown as content");
  }
  const target = isAbsolute(path) ? path : resolve(roots[0], path);
  const allowedTypes = READABLE_EXTENSIONS.join(" ");
  if (!readable(target)) {
    throw new JotviewError("not-allowed", `only ${allowedTypes} files can be read`);
  }

  let real;
  try {
    real = realpathSync(target);
  } catch {
    throw new JotviewError("not-found", `no such file: ${path}`);
  }
  const inside = roots.some((r) => real.startsWith(r.endsWith(sep) ? r : r + sep));
  if (!inside) {
    throw new JotviewError("not-allowed", `${path} is outside the folders this server may read (${roots.join(", ")})`);
  }
  if (!readable(real)) {
    throw new JotviewError("not-allowed", `only ${allowedTypes} files can be read`);
  }

  const stat = statSync(real);
  if (!stat.isFile()) throw new JotviewError("not-found", `not a file: ${path}`);
  if (stat.size > MAX_DOC_BYTES) {
    throw new JotviewError("too-large", `${path} is ${stat.size} bytes; the limit is ${MAX_DOC_BYTES}`);
  }
  return readFileSync(real, "utf8");
}
