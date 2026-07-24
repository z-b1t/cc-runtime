#!/usr/bin/env node
/**
 * Native Messaging host: write Creator clipboard custom formats
 * (`_dump_component_` / `_dump_node_`, …) via Win32 RegisterClipboardFormat.
 *
 * Protocol: 4-byte LE length + UTF-8 JSON on stdin/stdout.
 * Request:  { type: "writeClipboard"|"writeComponent", format?: string, payload }
 * Response: { ok: true } | { ok: false, error: string }
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function readMessage() {
  const header = Buffer.alloc(4);
  const n = fs.readSync(0, header, 0, 4);
  if (n !== 4) return null;
  const len = header.readUInt32LE(0);
  if (len <= 0 || len > 50 * 1024 * 1024) return null;
  const body = Buffer.alloc(len);
  let off = 0;
  while (off < len) {
    const r = fs.readSync(0, body, off, len - off);
    if (r <= 0) break;
    off += r;
  }
  return JSON.parse(body.toString("utf8"));
}

function writeMessage(msg) {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  fs.writeSync(1, header);
  fs.writeSync(1, body);
}

function writeWin32Clipboard(formatName, jsonText) {
  const ps1 = path.join(__dirname, "write-clipboard.ps1");
  const tmp = path.join(
    require("os").tmpdir(),
    `cc-runtime-clip-${process.pid}-${Date.now()}.json`,
  );
  fs.writeFileSync(tmp, jsonText, "utf8");
  try {
    const r = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        ps1,
        "-FormatName",
        formatName,
        "-JsonPath",
        tmp,
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
      },
    );
    if (r.status !== 0) {
      throw new Error(
        (r.stderr || r.stdout || "powershell failed").toString().slice(0, 500),
      );
    }
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function main() {
  try {
    const msg = readMessage();
    if (
      !msg ||
      (msg.type !== "writeClipboard" && msg.type !== "writeComponent")
    ) {
      writeMessage({ ok: false, error: "invalid request" });
      return;
    }
    const payload = msg.payload;
    if (!payload || typeof payload !== "object") {
      writeMessage({ ok: false, error: "missing payload" });
      return;
    }
    const format =
      msg.format ||
      (msg.type === "writeComponent" ? "_dump_component_" : null);
    if (!format || typeof format !== "string") {
      writeMessage({ ok: false, error: "missing format" });
      return;
    }
    const json = JSON.stringify(payload);
    if (process.platform === "win32") {
      writeWin32Clipboard(format, json);
    } else {
      writeMessage({
        ok: false,
        error: "native clipboard host only supports Windows",
      });
      return;
    }
    writeMessage({ ok: true });
  } catch (err) {
    writeMessage({
      ok: false,
      error: String(err && err.message ? err.message : err),
    });
  }
}

main();
