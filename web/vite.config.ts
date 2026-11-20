import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
    fs: {
      allow: [".."],
    },
  },
  optimizeDeps: {
    exclude: ["stitch-wasm"],
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
