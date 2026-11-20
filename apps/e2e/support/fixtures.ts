import { expect, request as playwrightRequest, test as base } from "@playwright/test";
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { ADMIN_STATE } from "./accounts";
import { ORIGIN } from "./env";
import { installGuard } from "./guard";

/** 写请求必须带的头：Origin 与 PUBLIC_ORIGIN 一致 + 自定义 CSRF 头（浏览器页面里的请求由前端代码带上） */
export const WRITE_HEADERS = { Origin: ORIGIN, "X-MailLink-Csrf": "1" } as const;

const EMPTY_STATE = { cookies: [], origins: [] };

type Fixtures = {
  /** 本用例内所有上下文收集到的违规；auto：每个用例都生效，结束时断言为空 */
  violations: string[];
  /** 打开一个新的、带全局断言的浏览器上下文（可带会话文件）；用例结束自动关闭 */
  openContext: (storageState?: string) => Promise<BrowserContext>;
  /** 以管理员会话发请求（带 Origin 与 CSRF 头），用来准备数据 */
  adminApi: APIRequestContext;
};

export const test = base.extend<Fixtures>({
  violations: [
    // eslint-disable-next-line no-empty-pattern -- Playwright 要求 fixture 的第一个参数是解构模式
    async ({}, use) => {
      const sink: string[] = [];
      await use(sink);
      expect(sink, "全局断言：无 CSP 违规、无外部请求、无未捕获异常、无 5xx").toEqual([]);
    },
    { auto: true },
  ],
  context: async ({ context, violations }, use) => {
    await installGuard(context, violations);
    await use(context);
  },
  openContext: async ({ browser, violations }, use) => {
    const opened: BrowserContext[] = [];
    await use(async (storageState) => {
      // 不带会话文件时显式给空会话：否则 `test.use({ storageState })` 会被新上下文继承
      const context = await browser.newContext({ baseURL: ORIGIN, locale: "zh-CN", storageState: storageState ?? EMPTY_STATE });
      await installGuard(context, violations);
      opened.push(context);
      return context;
    });
    await Promise.all(opened.map((context) => context.close()));
  },
  adminApi: async ({ baseURL }, use) => {
    const api = await playwrightRequest.newContext({ baseURL, storageState: ADMIN_STATE, extraHTTPHeaders: WRITE_HEADERS });
    await use(api);
    await api.dispose();
  },
});

export { expect };
