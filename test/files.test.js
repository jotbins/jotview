import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowedRoots, readAllowedFile } from "../src/files.js";
import { JotviewError, MAX_DOC_BYTES } from "../src/codec.js";

const base = realpathSync(mkdtempSync(join(tmpdir(), "jotview-files-")));
const project = join(base, "project");
const outside = join(base, "outside");
mkdirSync(join(project, "docs"), { recursive: true });
mkdirSync(outside);
writeFileSync(join(project, "docs", "plan.md"), "# Plan\n");
writeFileSync(join(project, "notes.TXT"), "plain notes\n");
writeFileSync(join(project, "secret.env"), "TOKEN=x\n");
writeFileSync(join(outside, "other.md"), "# Other\n");
writeFileSync(join(outside, "id_rsa"), "-----BEGIN KEY-----\n");
symlinkSync(join(outside, "other.md"), join(project, "link-out.md"));
symlinkSync(join(outside, "id_rsa"), join(project, "key.md"));
writeFileSync(join(project, "big.md"), "x".repeat(MAX_DOC_BYTES + 1));

const roots = [project];
const codeOf = (fn) => {
  try { fn(); } catch (err) { assert.ok(err instanceof JotviewError, String(err)); return err.code; }
  assert.fail("expected a JotviewError");
};

test("reads markdown and text inside a root, relative or absolute", () => {
  assert.equal(readAllowedFile("docs/plan.md", roots), "# Plan\n");
  assert.equal(readAllowedFile(join(project, "docs", "plan.md"), roots), "# Plan\n");
  assert.equal(readAllowedFile("notes.TXT", roots), "plain notes\n");
});

test("refuses other file types", () => {
  assert.equal(codeOf(() => readAllowedFile("secret.env", roots)), "not-allowed");
});

test("refuses files outside the roots, including via .. and symlinks", () => {
  assert.equal(codeOf(() => readAllowedFile(join(outside, "other.md"), roots)), "not-allowed");
  assert.equal(codeOf(() => readAllowedFile("../outside/other.md", roots)), "not-allowed");
  assert.equal(codeOf(() => readAllowedFile("link-out.md", roots)), "not-allowed");
  assert.equal(codeOf(() => readAllowedFile("key.md", roots)), "not-allowed");
});

test("missing and oversized files", () => {
  assert.equal(codeOf(() => readAllowedFile("nope.md", roots)), "not-found");
  assert.equal(codeOf(() => readAllowedFile("big.md", roots)), "too-large");
});

test("no roots means no file access", () => {
  assert.equal(codeOf(() => readAllowedFile("docs/plan.md", [])), "not-allowed");
});

test("allowedRoots: the working folder counts, unless it's / or home", () => {
  assert.deepEqual(allowedRoots({ cwd: project, home: outside }), [project]);
  assert.deepEqual(allowedRoots({ cwd: "/", home: outside }), []);
  assert.deepEqual(allowedRoots({ cwd: outside, home: outside }), []);
});

test("allowedRoots: --allow-dir adds folders; blanks and unfilled placeholders are ignored", () => {
  assert.deepEqual(
    allowedRoots({ cwd: "/", home: base, extra: [outside, "", "${user_config.docs_dir}"] }),
    [outside],
  );
  assert.deepEqual(allowedRoots({ cwd: project, home: base, extra: [project] }), [project]);
});

test("allowedRoots: an --allow-dir that isn't a folder is a usage error", () => {
  assert.equal(codeOf(() => allowedRoots({ cwd: "/", extra: [join(project, "docs", "plan.md")] })), "usage");
  assert.equal(codeOf(() => allowedRoots({ cwd: "/", extra: [join(base, "missing")] })), "usage");
});
