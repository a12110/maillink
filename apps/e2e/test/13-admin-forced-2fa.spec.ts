import type { APIRequestContext, Page } from "@playwright/test";
import { ADMIN_STATE, userAccount } from "../support/accounts";
import { addPasskey, addVirtualAuthenticator, createUserViaApi, enableTotp, logout, submitPassword } from "../support/actions";
import { expect, test } from "../support/fixtures";
import { totpAtStep } from "../support/totp";

// 本文件必须是最后一个：开启"管理员必须通过两步验证"期间，其余用例用的密码会话（e2e-admin）访问不了 /admin/*。
// 用例末尾由具备第二因素的管理员把设置关回去，并确认 e2e-admin 恢复可用。

const mfaAdmin = userAccount("mfa-admin");
const SETTINGS_PATH = "/api/admin/settings/security";
const SECURITY_PAGE = "/admin/settings/security";
const REQUIRE_2FA_LABEL = "管理员必须通过两步验证";

async function putRequire2fa(api: APIRequestContext, value: boolean): Promise<Awaited<ReturnType<APIRequestContext["put"]>>> {
  const current = (await (await api.get(SETTINGS_PATH)).json()) as Record<string, unknown>;
  return api.put(SETTINGS_PATH, { data: { ...current, admin_require_2fa: value } });
}

/** 在设置页勾选 / 取消"管理员必须通过两步验证"并保存 */
async function setRequire2faInUi(page: Page, value: boolean): Promise<void> {
  await page.goto(SECURITY_PAGE);
  const box = page.getByLabel(REQUIRE_2FA_LABEL);
  await expect(box).toBeChecked({ checked: !value });
  await box.setChecked(value);
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("status").getByText("设置已保存")).toBeVisible();
}

async function adminApiStatus(page: Page, path: string): Promise<{ status: number; code?: string }> {
  const response = await page.context().request.get(path);
  const body = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
  return { status: response.status(), code: body.error?.code };
}

test("管理员强制两步验证：只有密码的管理员被引导去启用，TOTP 登录与通行密钥登录的管理员放行", async ({ page, context, openContext, adminApi }) => {
  // 防锁死：此刻没有任何管理员具备第二因素，开启会被拒绝（对照：下面具备之后同样的请求成功）
  const refused = await putRequire2fa(adminApi, true);
  expect(refused.status()).toBe(400);
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("admin_2fa_lockout");

  // 第二个管理员：登记 TOTP 与一把通行密钥
  await createUserViaApi(adminApi, mfaAdmin, "admin");
  await addVirtualAuthenticator(context, page);
  await submitPassword(page, mfaAdmin);
  await expect(page).toHaveURL(/\/admin\/mailboxes$/);
  const { secret, step } = await enableTotp(page, mfaAdmin);
  await page.getByRole("button", { name: "我已保存，完成" }).click();
  await addPasskey(page, mfaAdmin, "E2E 管理员通行密钥");
  await logout(page);

  // e2e-admin（只有密码）在设置页开启。保存成功之后，它自己的会话立刻不再满足要求
  const passwordOnly = await (await openContext({ storageState: ADMIN_STATE })).newPage();
  await setRequire2faInUi(passwordOnly, true);
  expect(await adminApiStatus(passwordOnly, "/api/admin/users")).toEqual({ status: 403, code: "admin_2fa_required" });

  // 只有密码的管理员：/admin/* 页面显示"需要先启用两步验证"并给出入口，不渲染管理内容
  await passwordOnly.goto("/admin/users");
  await expect(passwordOnly.getByRole("heading", { name: "需要先启用两步验证", level: 1 })).toBeVisible();
  await expect(passwordOnly.getByText("管理功能暂时不可用")).toBeVisible();
  await expect(passwordOnly.getByRole("button", { name: "新建用户" })).toHaveCount(0);
  await passwordOnly.getByRole("link", { name: "去启用两步验证" }).first().click();
  await expect(passwordOnly).toHaveURL(/\/account#totp-title$/);
  // 账号安全页（/api/me/*）不受限，可以去启用
  await expect(passwordOnly.getByRole("heading", { name: "两步验证", level: 2 })).toBeVisible();

  // 对照 1：密码 + TOTP 登录的管理员放行。启用时用掉了当前时间步，登录用下一步的码
  await submitPassword(page, mfaAdmin);
  await expect(page.getByRole("heading", { name: "两步验证" })).toBeVisible();
  await page.getByLabel("验证码", { exact: true }).fill(totpAtStep(secret, step + 1));
  await page.getByRole("button", { name: "验证并登录" }).click();
  await expect(page).toHaveURL(/\/admin\/mailboxes$/);
  expect(await adminApiStatus(page, "/api/admin/users")).toEqual({ status: 200 });
  await logout(page);

  // 对照 2：通行密钥登录（本身就是多重验证；登录页没有"密码 + 通行密钥"的第二步，通行密钥是独立入口）放行
  await page.getByRole("button", { name: "使用通行密钥登录" }).click();
  await expect(page).toHaveURL(/\/admin\/mailboxes$/);
  expect(await adminApiStatus(page, "/api/admin/users")).toEqual({ status: 200 });

  // 收尾：用这个合格会话把设置关回去，e2e-admin 恢复可用
  await setRequire2faInUi(page, false);
  expect(await adminApiStatus(passwordOnly, "/api/admin/users")).toEqual({ status: 200 });
  expect((await adminApi.get("/api/admin/users")).status()).toBe(200);
});
