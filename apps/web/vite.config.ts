import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * 联调目标：本地 Worker（wrangler dev）。可用 WORKER_ORIGIN 覆盖，如 WORKER_ORIGIN=http://localhost:8794。
 * 注意：写请求的 Origin 校验要求浏览器访问地址 == Worker 的 PUBLIC_ORIGIN，
 * 所以经 Vite 代理联调时，PUBLIC_ORIGIN 必须设成 Vite 的地址（见根 README「前端联调」）。
 */
const WORKER_ORIGIN = process.env.WORKER_ORIGIN ?? "http://localhost:8787";

const TEST_TIMEOUT_MS = 60_000;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // changeOrigin:false 保持浏览器发出的 Origin / Host，Worker 才能按 PUBLIC_ORIGIN 校验
      "/api": { target: WORKER_ORIGIN, changeOrigin: false },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: TEST_TIMEOUT_MS,
    // 主题测试要读 tokens.css 原文做对比度基准；vitest 默认把 CSS（含 ?raw）置空
    css: { include: [/tokens\.css/] },
  },
});
