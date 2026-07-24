const asar = require("./node_modules/asar");
const fs = require("fs");
const path = require("path");
const p = "D:/Program Files/Cocos/editors/Creator/3.8.8/resources/app.asar";
const o = path.join(__dirname, "extract");
fs.mkdirSync(o, { recursive: true });
const files = [
  "node_modules/@editor/creator/dist/clipboard/index.ccc",
  "node_modules/iclipboard/cjs/index.js",
  "node_modules/iclipboard/cjs/copy.js",
];
for (const f of files) {
  try {
    const buf = asar.extractFile(p, f);
    fs.writeFileSync(path.join(o, f.replace(/[\\/]/g, "_")), buf);
    console.log("OK", f, buf.length);
  } catch (e) {
    console.log("FAIL", f, e.message);
  }
}
const list = asar.listPackage(p);
const candidates = list.filter((x) => {
  const s = String(x).replace(/\\/g, "/");
  return (s.includes("@editor/creator") || s.includes("modules/editor")) && /\.(js|cjs|mjs)$/.test(s);
});
console.log("candidates", candidates.length);
const needles = ["_dump_component_", "writeBuffer", "availableFormats", "Clipboard"];
const found = [];
for (const raw of candidates) {
  const f = String(raw).replace(/^\\/, "").replace(/\\/g, "/");
  try {
    const buf = asar.extractFile(p, f);
    const s = buf.toString("utf8");
    const hit = needles.filter((n) => s.includes(n));
    if (hit.includes("_dump_component_") || hit.includes("writeBuffer") || (hit.includes("availableFormats") && hit.includes("Clipboard"))) {
      found.push({ f, hit, size: buf.length });
      if (found.length <= 15) fs.writeFileSync(path.join(o, "hit_" + found.length + "_" + path.basename(f)), buf);
    }
  } catch {}
}
console.log("FOUND", found.length);
for (const item of found.slice(0, 40)) console.log(item.hit.join(","), item.size, item.f);
const ccc = path.join(o, "node_modules_@editor_creator_dist_clipboard_index.ccc");
if (fs.existsSync(ccc)) {
  const buf = fs.readFileSync(ccc);
  const ascii = [];
  let cur = "";
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c >= 32 && c < 127) cur += String.fromCharCode(c);
    else { if (cur.length >= 5) ascii.push(cur); cur = ""; }
  }
  if (cur.length >= 5) ascii.push(cur);
  const interesting = ascii.filter((s) => /clip|dump|write|read|buffer|electron|JSON/i.test(s));
  fs.writeFileSync(path.join(o, "ccc-strings.txt"), interesting.join("\n"));
  console.log("interesting", interesting.length);
  console.log(interesting.slice(0, 100).join("\n"));
}
