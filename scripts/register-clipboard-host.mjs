/**
 * Register the Windows Native Messaging host so the extension can write
 * Electron-compatible `_dump_component_` clipboard data.
 *
 * Usage (after loading unpacked dist/ once to get an extension id):
 *   node scripts/register-clipboard-host.mjs <chrome-extension-id>
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const hostDir = path.join(root, "native-host");
const extId = process.argv[2];

if (!extId || !/^[a-p]{32}$/.test(extId)) {
  console.error(
    "Usage: node scripts/register-clipboard-host.mjs <32-char-extension-id>",
  );
  console.error(
    "Find the id on chrome://extensions with Developer mode enabled.",
  );
  process.exit(1);
}

if (process.platform !== "win32") {
  console.error("Clipboard host registration is Windows-only.");
  process.exit(1);
}

const nodePath = process.execPath;
const hostJs = path.join(hostDir, "clipboard-host.js");
const batPath = path.join(hostDir, "clipboard-host.cmd");
const bat = `@echo off\r\n"${nodePath}" "${hostJs}"\r\n`;
fs.writeFileSync(batPath, bat, "utf8");

const manifestPath = path.join(
  hostDir,
  "com.cocos.cc_runtime.clipboard.installed.json",
);
const manifest = {
  name: "com.cocos.cc_runtime.clipboard",
  description: "cc-runtime Win32 clipboard host for Creator _dump_component_",
  path: batPath.replace(/\\/g, "\\\\"),
  type: "stdio",
  allowed_origins: [`chrome-extension://${extId}/`],
};
// Native host "path" must be absolute without double-escaped backslashes in JSON file
manifest.path = batPath;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

const regKey =
  "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.cocos.cc_runtime.clipboard";
const r = spawnSync(
  "reg",
  ["add", regKey, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"],
  { encoding: "utf8" },
);
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(1);
}

console.log("Registered native messaging host:");
console.log(" ", manifestPath);
console.log("Reload the cc-runtime extension, then copy a component again.");
