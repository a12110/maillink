import { userAccount } from "../support/accounts";
import { addPasskey, addVirtualAuthenticator, createUserViaApi, loginWithPassword, logout } from "../support/actions";
import { expect, test } from "../support/fixtures";

const account = userAccount("passkey");
const PASSKEY_NAME = "E2E 虚拟通行密钥";

test("通行密钥：用虚拟认证器注册，退出后用通行密钥登录", async ({ page, context, adminApi }) => {
  await createUserViaApi(adminApi, account);

  // 虚拟认证器：CTAP2、内置（平台）认证器、支持并已通过用户验证；必须在注册之前建好
  const { cdp, authenticatorId } = await addVirtualAuthenticator(context, page);

  await loginWithPassword(page, account, "/inbox");
  await page.goto("/account");
  await expect(page.getByText("还没有通行密钥")).toBeVisible();
  await addPasskey(page, account, PASSKEY_NAME);
  const list = page.getByRole("list", { name: "通行密钥列表" });
  await expect(list.getByText(PASSKEY_NAME)).toBeVisible();
  await expect(list.getByText("还没有用过")).toBeVisible();
  expect((await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials).toHaveLength(1);
  await logout(page);

  // 通行密钥登录：不需要密码，也不再问验证码
  await page.getByRole("button", { name: "使用通行密钥登录" }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await page.goto("/account");
  await expect(page.getByRole("list", { name: "通行密钥列表" }).getByText("最近使用")).toBeVisible();
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  expect(credentials[0]?.signCount).toBeGreaterThan(0);
});
