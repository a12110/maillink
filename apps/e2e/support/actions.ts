import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { Account } from "./accounts";
import { currentTotpStep, totpAtStep } from "./totp";

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

/** 管理员 API 建一个用户（准备数据；UI 创建用户有自己的用例） */
export async function createUserViaApi(adminApi: APIRequestContext, account: Account, role: "user" | "admin" = "user"): Promise<number> {
  const response = await adminApi.post("/api/admin/users", { data: { ...account, role } });
  expect(response.status(), `创建用户 ${account.username}：${await response.text()}`).toBe(201);
  return ((await response.json()) as { id: number }).id;
}

/**
 * 在已登录的账号安全页启用 TOTP：读手动密钥、按 RFC 6238 算码、提交，停在"恢复码只显示一次"面板（调用方可检查并点"完成"）。
 * 返回密钥与启用时用掉的时间步（同一步的码只能用一次，之后登录用下一步的码）。
 */
export async function enableTotp(page: Page, account: Account): Promise<{ secret: string; step: number }> {
  await page.goto("/account");
  await page.getByRole("button", { name: "启用两步验证" }).click();
  const secret = (await page.locator('code[aria-label="手动输入的密钥"]').innerText()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  const step = currentTotpStep();
  const section = page.getByRole("region", { name: "两步验证" });
  await section.getByLabel("验证码", { exact: true }).fill(totpAtStep(secret, step));
  await section.getByLabel("当前密码").fill(account.password);
  await section.getByRole("button", { name: "启用两步验证" }).click();
  await expect(page.getByRole("region", { name: "恢复码" })).toBeVisible();
  return { secret, step };
}

/** 给页面挂一个 CTAP2 内置认证器（支持并已通过用户验证）；必须在注册、登录通行密钥之前建好 */
export async function addVirtualAuthenticator(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

/** 在账号安全页添加一把通行密钥（用当前密码再确认） */
export async function addPasskey(page: Page, account: Account, name: string): Promise<void> {
  await page.goto("/account");
  await page.getByRole("button", { name: "添加通行密钥" }).click();
  const dialog = page.getByRole("dialog", { name: "添加通行密钥" });
  await dialog.getByLabel("名称（可选）").fill(name);
  // 已启用 TOTP 的账号会多一个"用什么确认"的单选，默认就是当前密码
  await dialog.getByRole("textbox", { name: "当前密码" }).fill(account.password);
  await dialog.getByRole("button", { name: "继续并创建" }).click();
  await expect(page.getByRole("status").getByText(`已添加通行密钥“${name}”`)).toBeVisible();
}
