import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import path from "node:path";
import { defineConfig } from "vitest/config";

const TEST_TIMEOUT_MS = 60_000;

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // 仅测试用：迁移内容交给测试里的 applyD1Migrations 执行；
          // APP_SECRET / SETUP_TOKEN 是测试专用的假值，不对应任何真实环境
          bindings: {
            TEST_MIGRATIONS: migrations,
            APP_SECRET: "test-app-secret-0123456789abcdef0123456789abcdef",
            SETUP_TOKEN: "test-setup-token",
          },
        },
      };
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: TEST_TIMEOUT_MS,
  },
});
