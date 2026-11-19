import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** 本地 Worker（wrangler dev）的默认地址 */
const WORKER_ORIGIN = "http://localhost:8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": { target: WORKER_ORIGIN, changeOrigin: false },
    },
  },
});
