#!/usr/bin/env node
/** Smoke checks for dist build artifacts. */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;

function ok(cond, msg) {
  if (cond) console.log("OK ", msg);
  else {
    console.error("FAIL", msg);
    failed++;
  }
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function contains(rel, needle) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return false;
  return fs.readFileSync(p, "utf8").includes(needle);
}

ok(exists("dist/manifest.json"), "dist manifest");
ok(exists("dist/injected.js"), "dist injected");
ok(exists("dist/content.js"), "dist content");
ok(exists("dist/background.js"), "dist background");
ok(exists("dist/devtool/index.html"), "dist panel html");
ok(exists("dist/assets/icon.png"), "dist icon");
ok(exists("dist/assets/icon-16.png"), "dist icon-16");
ok(exists("dist/assets/icon-128.png"), "dist icon-128");
ok(contains("dist/manifest.json", '"side_panel"'), "manifest side_panel");
ok(contains("dist/manifest.json", "default_icon"), "manifest action default_icon");
ok(!contains("dist/manifest.json", "devtools_page"), "manifest no devtools_page");
ok(contains("dist/injected.js", "loadingComplete"), "injected loadingComplete");
ok(contains("dist/injected.js", "refreshSceneData"), "injected refreshSceneData");
ok(contains("dist/devtool/index.html", "index-"), "panel hashed bundle");

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll smoke checks passed");
