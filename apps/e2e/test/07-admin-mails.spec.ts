import { ADMIN_STATE } from "../support/accounts";
import { warmMailIndex } from "../support/data";
import { expect, test } from "../support/fixtures";

test.use({ storageState: ADMIN_STATE });

const HTML_MAIL_ID = 4;
const EXPECTED_SANDBOX = "allow-popups allow-popups-to-escape-sandbox";

test("管理员「全部邮件」：HTML 邮件在沙箱 iframe 里显示，默认不发远程图片请求", async ({ page, adminApi }) => {
  await warmMailIndex(adminApi);
  // 种子里 #4 的 HTML 带一张 tracker.example.com 的跟踪像素和一段 <script>
  const trackerRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("tracker.example.com")) trackerRequests.push(request.url());
  });

  await page.goto("/admin/mails");
  await expect(page.getByRole("heading", { name: "全部邮件", level: 1 })).toBeVisible();
  const row = page.locator(`[data-mail-id="${HTML_MAIL_ID}"]`);
  await expect(row).toContainText("Example Weekly");
  await row.click();

  const frame = page.locator(`iframe[title="邮件 ${HTML_MAIL_ID} 的正文"]`);
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("sandbox", EXPECTED_SANDBOX);
  await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  // 邮件内容确实渲染出来了，且清洗后没有脚本、没有指向外部的图片地址
  await expect(page.frameLocator(`iframe[title="邮件 ${HTML_MAIL_ID} 的正文"]`).getByRole("heading", { name: "Example Weekly" })).toBeVisible();
  const srcdoc = (await frame.getAttribute("srcdoc")) ?? "";
  expect(srcdoc).not.toMatch(/<script/i);
  expect(srcdoc).not.toContain("tracker.example.com");

  // 远程图片开关默认关闭；整个过程没有任何对 tracker 的请求（全局断言还会拦住所有非本站请求）
  await expect(page.getByRole("checkbox", { name: "加载远程图片" })).not.toBeChecked();
  expect(trackerRequests).toEqual([]);
});
