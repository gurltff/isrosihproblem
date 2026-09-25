import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

// `npm run dev:https` serves over self-signed HTTPS on the LAN so phones can
// open the camera (browsers only allow getUserMedia on HTTPS or localhost).
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "https" ? [basicSsl()] : [])],
  server: {
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: { chunkSizeWarningLimit: 900 },
}));
