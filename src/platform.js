import { spawnSync } from "node:child_process";

/**
 * @param {string} platform  a `process.platform` value
 * @returns {{cmd: string, args: string[]}}
 */
export function openCommand(platform) {
  switch (platform) {
    case "darwin": return { cmd: "open", args: [] };
    case "linux": return { cmd: "xdg-open", args: [] };
    // The empty string is `start`'s title argument; without it a URL
    // containing spaces or quotes is treated as the window title.
    case "win32": return { cmd: "cmd", args: ["/c", "start", ""] };
    default: throw new Error(`unsupported platform: ${platform}`);
  }
}

/**
 * @param {string} platform
 * @returns {{cmd: string, args: string[]}}
 */
export function copyCommand(platform) {
  switch (platform) {
    case "darwin": return { cmd: "pbcopy", args: [] };
    case "win32": return { cmd: "clip", args: [] };
    case "linux": return { cmd: "xclip", args: ["-selection", "clipboard"] };
    default: throw new Error(`unsupported platform: ${platform}`);
  }
}

/**
 * @param {{status: number|null, error?: Error}} result
 * @param {string} cmd
 * @returns {{ok: boolean, reason?: string}}
 */
function outcome(result, cmd) {
  if (result.error) return { ok: false, reason: result.error.message };
  if (result.status !== 0) return { ok: false, reason: `${cmd} exited with ${result.status}` };
  return { ok: true };
}

/**
 * @param {string} url
 * @param {{platform?: string, spawnImpl?: typeof spawnSync}} [options]
 * @returns {{ok: boolean, reason?: string}}
 */
export function openUrl(url, options = {}) {
  const platform = options.platform ?? process.platform;
  const run = options.spawnImpl ?? spawnSync;
  try {
    const { cmd, args } = openCommand(platform);
    return outcome(run(cmd, [...args, url]), cmd);
  } catch (err) {
    return { ok: false, reason: /** @type {Error} */ (err).message };
  }
}

/**
 * @param {string} text
 * @param {{platform?: string, spawnImpl?: typeof spawnSync}} [options]
 * @returns {{ok: boolean, reason?: string}}
 */
export function copyText(text, options = {}) {
  const platform = options.platform ?? process.platform;
  const run = options.spawnImpl ?? spawnSync;
  try {
    const { cmd, args } = copyCommand(platform);
    return outcome(run(cmd, args, { input: text }), cmd);
  } catch (err) {
    return { ok: false, reason: /** @type {Error} */ (err).message };
  }
}
