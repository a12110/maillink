import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { Account } from "./accounts";

/** 在登录页填密码并提交（不等待结果，调用方按场景断言：直接进入、或进入两步验证） */
export async function submitPassword(page: Page, account: Account): Promise<void> {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "登录", exact: true })).toBeVisible();
  await page.getByLabel("用户名").fill(account.username);
  await page.getByLabel("密码", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
}

/** 密码登录，普通用户落在 /inbox，管理员落在 /admin/mailboxes */
export async function loginWithPassword(page: Page, account: Account, landing: "/inbox" | "/admin/mailboxes"): Promise<void> {
  await submitPassword(page, account);
  await expect(page).toHaveURL(new RegExp(`${landing}$`));
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** 管理员 API 建一个普通用户（准备数据；UI 创建用户有自己的用例） */
export async function createUserViaApi(adminApi: APIRequestContext, account: Account): Promise<number> {
  const response = await adminApi.post("/api/admin/users", { data: { ...account, role: "user" } });
  expect(response.status(), `创建用户 ${account.username}：${await response.text()}`).toBe(201);
  return ((await response.json()) as { id: number }).id;
}
