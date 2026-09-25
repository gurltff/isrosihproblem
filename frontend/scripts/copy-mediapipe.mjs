// Copies MediaPipe's WASM runtime next to the app so hand tracking works
// without a CDN (and offline, e.g. on a flaky venue network).
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const dest = join(root, "public/mediapipe/wasm");
if (!existsSync(src)) {
  console.warn("[copy-mediapipe] @mediapipe/tasks-vision not installed; skipping");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const f of readdirSync(src)) {
  if (f.includes("module_internal")) continue; // only the classic loader is used
  cpSync(join(src, f), join(dest, f));
}
console.log("[copy-mediapipe] wasm runtime ready in public/mediapipe/wasm");
