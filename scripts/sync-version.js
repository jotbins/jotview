// Runs as the npm `version` hook: copies package.json's new version into the
// Desktop bundle manifest and the MCP Registry entry, so a tag never ships
// mismatched metadata. `npm version` then commits them with package.json.
import { readFileSync, writeFileSync } from "node:fs";

const read = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const write = (file, data) =>
  writeFileSync(new URL(`../${file}`, import.meta.url), `${JSON.stringify(data, null, 2)}\n`);

const { version } = read("package.json");

const manifest = read("manifest.json");
manifest.version = version;
write("manifest.json", manifest);

const server = read("server.json");
server.version = version;
for (const pkg of server.packages) pkg.version = version;
write("server.json", server);
