import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "web", "src", "wasm");
fs.mkdirSync(outDir, { recursive: true });

console.log("[wasm] Compiling stitch-wasm -> wasm32-unknown-unknown (release)...");
execFileSync(
  "cargo",
  ["build", "--release", "--target", "wasm32-unknown-unknown", "-p", "stitch-wasm"],
  { cwd: root, stdio: "inherit" },
);

const srcWasm = path.join(
  root,
  "target",
  "wasm32-unknown-unknown",
  "release",
  "stitch_wasm.wasm",
);
const dstWasm = path.join(outDir, "stitch_wasm.wasm");
fs.copyFileSync(srcWasm, dstWasm);

const kb = (fs.statSync(dstWasm).size / 1024).toFixed(1);
console.log(`[wasm] Built ${path.relative(root, dstWasm)} (${kb} KB)`);
