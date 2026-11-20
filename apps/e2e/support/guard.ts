import type { BrowserContext } from "@playwright/test";
import { ORIGIN } from "./env";

// 全局断言：每个浏览器上下文都挂上这些监听，违规写进 sink，用例结束时由 fixture 断言 sink 为空。
// - CSP 违规：`securitypolicyviolation` 事件（含 iframe 里的文档）与控制台里的 CSP 报错；
// - 对非 ORIGIN 的请求（邮件远程图片、第三方脚本等，含 iframe 与弹窗）；
// - 未捕获异常（`weberror`）；
// - /api/* 返回 5xx。
// 预期内的 4xx（例如未登录时 /api/auth/session 的 401）不算失败。

const BINDING_NAME = "__mlReportViolation";
const NETWORK_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);
const CSP_CONSOLE_PATTERN = /Content Security Policy|Refused to (?:load|execute|apply|connect|frame)/i;
const SERVER_ERROR_MIN = 500;

type ReportWindow = Window & { [BINDING_NAME]?: (message: string) => void };

export async function installGuard(context: BrowserContext, sink: string[]): Promise<void> {
  await context.exposeBinding(BINDING_NAME, (_source, message: string) => {
    sink.push(message);
  });
  await context.addInitScript((name: string) => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (window as ReportWindow)[name as typeof BINDING_NAME];
      report?.(`CSP 违规：${event.violatedDirective} 拦截了 ${event.blockedURI}（文档 ${event.documentURI}）`);
    });
  }, BINDING_NAME);

  context.on("request", (request) => {
    const url = new URL(request.url());
    if (NETWORK_PROTOCOLS.has(url.protocol) && url.origin !== ORIGIN) sink.push(`外部请求：${request.method()} ${request.url()}`);
  });
  context.on("console", (message) => {
    if (CSP_CONSOLE_PATTERN.test(message.text())) sink.push(`控制台 CSP 报错：${message.text()}`);
  });
  context.on("weberror", (webError) => {
    sink.push(`未捕获异常：${webError.error().message}`);
  });
  context.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === ORIGIN && url.pathname.startsWith("/api/") && response.status() >= SERVER_ERROR_MIN) {
      sink.push(`服务端错误：${response.status()} ${response.request().method()} ${url.pathname}`);
    }
  });
}
