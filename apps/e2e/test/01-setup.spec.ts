import { ADMIN, ADMIN_STATE } from "../support/accounts";
import { loginWithPassword } from "../support/actions";
import { SETUP_TOKEN } from "../support/env";
import { expect, test } from "../support/fixtures";

test("初始化：用 SETUP_TOKEN 创建管理员，登录并进入管理端", async ({ page, context }) => {
  // 还没有任何用户：任何页面都先跳到初始化页
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "初始化系统" })).toBeVisible();

  await page.getByLabel("用户名").fill(ADMIN.username);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN.password);

  // 错误的令牌：留在本页，错误显示在令牌字段下
  await page.getByLabel("初始化令牌").fill("not-the-setup-token");
  await page.getByRole("button", { name: "创建管理员" }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.locator(".field-error")).toBeVisible();

  await page.getByLabel("初始化令牌").fill(SETUP_TOKEN);
  await page.getByRole("button", { name: "创建管理员" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("status").getByText("管理员已创建，请登录")).toBeVisible();

  // 初始化完成后 /setup 不再可用
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/login$/);

  await loginWithPassword(page, ADMIN, "/admin/mailboxes");
  await expect(page.getByRole("heading", { name: "收件地址", level: 1 })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "主导航" });
  for (const label of ["收件地址", "规则组", "全部邮件", "用户", "系统设置", "审计日志"]) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }

  await context.storageState({ path: ADMIN_STATE });
});
