import { defineConfig, devices } from "@playwright/test";
import { ORIGIN } from "./support/env";

const SECOND_MS = 1000;
const SERVER_START_TIMEOUT_MS = 240 * SECOND_MS;
const SERVER_STOP_TIMEOUT_MS = 20 * SECOND_MS;

export default defineConfig({
  testDir: "test",
  outputDir: "test-results",
  // 单 worker 串行：所有用例共用一个 wrangler dev 与同一份临时数据，后面的用例依赖前面创建的数据
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60 * SECOND_MS,
  expect: { timeout: 10 * SECOND_MS },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    ...devices["Desktop Chrome"],
    // 用本机 Google Chrome，不下载 Playwright 自带的浏览器
    channel: "chrome",
    baseURL: ORIGIN,
    locale: "zh-CN",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // 初始化用例创建管理员并保存会话，其余用例依赖它
    { name: "setup", testMatch: /01-setup\.spec\.ts$/ },
    { name: "flows", testIgnore: /01-setup\.spec\.ts$/, dependencies: ["setup"] },
  ],
  webServer: {
    command: "node scripts/serve.ts",
    url: `${ORIGIN}/api/setup/status`,
    reuseExistingServer: false,
    timeout: SERVER_START_TIMEOUT_MS,
    gracefulShutdown: { signal: "SIGTERM", timeout: SERVER_STOP_TIMEOUT_MS },
    stdout: "pipe",
    stderr: "pipe",
  },
});
