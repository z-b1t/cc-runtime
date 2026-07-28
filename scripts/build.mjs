import * as esbuild from "esbuild";
import { build as viteBuild } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function buildExtensionScripts() {
  const entries = [
    { in: "src/background/index.ts", out: "background.js" },
    { in: "src/content/index.ts", out: "content.js" },
    { in: "src/injected/index.ts", out: "injected.js" },
  ];
  for (const e of entries) {
    await esbuild.build({
      entryPoints: [path.join(root, e.in)],
      bundle: true,
      outfile: path.join(dist, e.out),
      format: "iife",
      platform: "browser",
      target: "chrome100",
      sourcemap: false,
      minify: false,
    });
    console.log("esbuild:", e.out);
  }
}

async function main() {
  rmrf(dist);
  fs.mkdirSync(dist, { recursive: true });

  await buildExtensionScripts();
  await viteBuild({ configFile: path.join(root, "vite.config.ts") });

  copyFile(path.join(root, "src/manifest.json"), path.join(dist, "manifest.json"));
  for (const name of ["icon.png", "icon-16.png", "icon-32.png", "icon-48.png", "icon-128.png"]) {
    copyFile(path.join(root, "src/assets", name), path.join(dist, "assets", name));
  }

  // Chrome extension pages break on Vite's crossorigin attribute for module scripts.
  const panelHtml = path.join(dist, "devtool", "index.html");
  if (fs.existsSync(panelHtml)) {
    let html = fs.readFileSync(panelHtml, "utf8");
    html = html.replace(/\s+crossorigin(?:="[^"]*")?/g, "");
    fs.writeFileSync(panelHtml, html);
  }

  console.log("Build complete →", dist);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
