import type { Page } from "@playwright/test";
import { ADMIN_STATE, userAccount } from "../support/accounts";
import { loginWithPassword } from "../support/actions";
import { warmMailIndex } from "../support/data";
import { expect, test } from "../support/fixtures";

test.use({ storageState: ADMIN_STATE });

// 06 里建的普通用户（已授权 plain.user，规则组「仅验证码」）
const viewer = userAccount("viewer");
const PICKED = ["zh.user@example.com", "ja.user@example.com"] as const;

/** 在收件地址页勾选这两个地址，批量条随之出现 */
async function selectPickedMailboxes(page: Page): Promise<void> {
  await page.goto("/admin/mailboxes");
  for (const address of PICKED) await page.getByRole("checkbox", { name: `选择 ${address}` }).check();
  await expect(page.getByRole("toolbar", { name: "批量操作" })).toContainText("已选 2 项");
}

test("收件地址页多选 →「生成取件链接」：创建对话框预选地址并显示地址文本，关闭后清掉 create_for", async ({ page }) => {
  await selectPickedMailboxes(page);
  await page.getByRole("toolbar", { name: "批量操作" }).getByRole("button", { name: "生成取件链接" }).click();

  await expect(page).toHaveURL(/\/admin\/links\?.*create_for/);
  const dialog = page.getByRole("dialog", { name: "生成取件链接" });
  await expect(dialog.getByText("已选 2 个")).toBeVisible();
  const preview = dialog.locator(".picker-selected");
  for (const address of PICKED) await expect(preview).toContainText(address);
  await expect(preview).not.toContainText("#");

  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/create_for/);
});

test("收件地址页多选 →「授权给用户」：逐条结果为已授权，该用户 /inbox 能看到这两个地址", async ({ page, adminApi, openContext }) => {
  await warmMailIndex(adminApi);
  await selectPickedMailboxes(page);
  await page.getByRole("toolbar", { name: "批量操作" }).getByRole("button", { name: "授权给用户" }).click();

  const dialog = page.getByRole("dialog", { name: "授权 2 个地址给用户" });
  await dialog.getByRole("list", { name: "用户列表" }).getByRole("checkbox", { name: new RegExp(viewer.username) }).check();
  await dialog.getByRole("button", { name: "授权 1 个用户" }).click();

  await expect(dialog.getByText("授权完成")).toBeVisible();
  const results = dialog.getByRole("list", { name: "逐条结果" }).getByRole("listitem");
  await expect(results).toHaveCount(PICKED.length);
  for (const address of PICKED) {
    const row = results.filter({ hasText: address });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("已授权");
    await expect(row).toContainText(viewer.username);
  }
  await dialog.getByRole("button", { name: "完成" }).click();

  // 用户：原有的 plain.user + 新授权的两个，规则组是「完整访问」所以能看到邮件列表
  const viewerPage = await (await openContext()).newPage();
  await loginWithPassword(viewerPage, viewer, "/inbox");
  const select = viewerPage.getByLabel("收件地址", { exact: true });
  await expect(select.locator("option")).toHaveCount(PICKED.length + 2);
  for (const address of PICKED) await expect(select.locator("option", { hasText: address })).toHaveCount(1);
  await select.selectOption({ label: PICKED[0] });
  const rows = viewerPage.locator("button.mail-item");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("您的登录验证码");
});
