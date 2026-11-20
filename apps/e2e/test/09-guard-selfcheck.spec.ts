import { expect, test } from "../support/fixtures";

// 全局断言本身的自检：故意制造四类违规，确认守卫确实记录到了；断言完再清空，不让它们算作失败。

test("守卫自检：CSP 违规、外部请求、未捕获异常、5xx 都会被记录", async ({ page, violations }) => {
  await page.route("**/api/public/config", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"boom","message":"boom"}}' }));
  await page.goto("/login");
  await expect.poll(() => violations.some((item) => item.startsWith("服务端错误：500"))).toBe(true);

  // 内联脚本不在 script-src 的哈希里：浏览器拦截并触发 securitypolicyviolation 与控制台报错
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__selfcheck = 1";
    document.head.append(script);
  });
  await expect.poll(() => violations.some((item) => item.startsWith("CSP 违规："))).toBe(true);
  await expect.poll(() => violations.some((item) => item.startsWith("控制台 CSP 报错："))).toBe(true);

  // img-src 放行 https:，所以这个请求会真的发出（连不上，没关系），守卫按"非本站请求"记录
  await page.evaluate(() => {
    new Image().src = "https://selfcheck.invalid/pixel.gif";
  });
  await expect.poll(() => violations.some((item) => item.startsWith("外部请求：GET https://selfcheck.invalid/"))).toBe(true);

  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("selfcheck-uncaught");
    });
  });
  await expect.poll(() => violations.some((item) => item.includes("selfcheck-uncaught"))).toBe(true);

  violations.length = 0;
});

test("守卫自检：没有 allow-scripts 的邮件 iframe 里的 CSP 违规，经控制台报错被发现", async ({ page, violations }) => {
  await page.goto("/login");
  // 与邮件正文同样的沙箱属性：iframe 里不能运行脚本，所以 securitypolicyviolation 监听在里面不会运行，只剩控制台报错这条路。
  // srcdoc 继承页面 CSP，img-src 不含 http:，这张图被拦
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
    frame.srcdoc = '<img src="http://selfcheck.invalid/pixel.gif" alt="">';
    document.body.append(frame);
  });
  await expect.poll(() => violations.some((item) => item.startsWith("控制台 CSP 报错：") && item.includes("selfcheck.invalid"))).toBe(true);
  // 页面本身没有收到事件型记录：说明上面是 iframe 里的违规，靠的确实是控制台这条路
  expect(violations.some((item) => item.startsWith("CSP 违规："))).toBe(false);

  violations.length = 0;
});
