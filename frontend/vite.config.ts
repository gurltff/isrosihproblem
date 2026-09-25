import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

const here = dirname(fileURLToPath(import.meta.url));
const STATIC = process.env.VITE_STATIC === "1";
// build-pages.sh writes the pre-rendered API answers here before building.
const STATIC_BUNDLE = resolve(here, ".static/bundle.json");

// `npm run dev:https` serves over self-signed HTTPS on the LAN so phones can
// open the camera (browsers only allow getUserMedia on HTTPS or localhost).
export default defineConfig(({ mode }) => ({
  define: { __BUILD__: JSON.stringify(Date.now().toString(36)) },
  plugins: [react(), ...(mode === "https" ? [basicSsl()] : [])],
  resolve: {
    alias: {
      // The static (GitHub Pages) build compiles its data into the app so page
      // changes never wait on, or break on, a network request.
      "virtual:static-bundle":
        STATIC && existsSync(STATIC_BUNDLE) ? STATIC_BUNDLE : resolve(here, "src/lib/empty-bundle.json"),
    },
  },
  server: {
    fs: { allow: [".."] }, // shared/vision_brief.json sits beside frontend/
    proxy: STATIC ? undefined : { "/api": "http://127.0.0.1:8000" },
  },
  build: {
    chunkSizeWarningLimit: 3000,
    // One script file for the static build: no lazily loaded piece can go
    // missing when a browser holds a page from an earlier deploy.
    rollupOptions: STATIC ? { output: { inlineDynamicImports: true } } : undefined,
  },
}));
