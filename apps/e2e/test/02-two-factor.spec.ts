import { userAccount } from "../support/accounts";
import { createUserViaApi, enableTotp, loginWithPassword, logout, submitPassword } from "../support/actions";
import { expect, test } from "../support/fixtures";
import { totpAtStep } from "../support/totp";

const account = userAccount("totp");
const RECOVERY_CODE_COUNT = 10;

test("两步验证：启用 TOTP 并保存恢复码，恢复码只能用一次，密码 + 验证码登录", async ({ page, adminApi }) => {
  await createUserViaApi(adminApi, account);
  await loginWithPassword(page, account, "/inbox");

  // 启用：从页面拿手动密钥，按 RFC 6238 算出验证码
  const { secret, step: enabledStep } = await enableTotp(page, account);

  // 恢复码只显示这一次：读出全部，并核对"下载为文本文件"的内容
  const panel = page.getByRole("region", { name: "恢复码" });
  await expect(panel).toBeVisible();
  const codes = await panel.getByRole("list", { name: "恢复码列表" }).getByRole("listitem").allInnerTexts();
  expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
  expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "下载为文本文件" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("maillink-recovery-codes.txt");
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).toString("utf8")).toContain(codes[0]);

  await panel.getByRole("button", { name: "我已保存，完成" }).click();
  await expect(page.getByText("已启用", { exact: true })).toBeVisible();
  await expect(page.getByText("剩余恢复码").locator("b")).toHaveText(String(RECOVERY_CODE_COUNT));
  await logout(page);

  // 恢复码登录一次成功
  const [recoveryCode] = codes as [string];
  await submitPassword(page, account);
  await page.getByRole("button", { name: "改用恢复码" }).click();
  await page.getByLabel("恢复码", { exact: true }).fill(recoveryCode);
  await page.getByRole("button", { name: "验证并登录" }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await page.goto("/account");
  await expect(page.getByText("剩余恢复码").locator("b")).toHaveText(String(RECOVERY_CODE_COUNT - 1));
  await logout(page);

  // 再登录一次（登录接口有限流，两个检查共用这一次密码登录）：同一个恢复码被拒绝，仍停在第二步……
  await submitPassword(page, account);
  await page.getByRole("button", { name: "改用恢复码" }).click();
  await page.getByLabel("恢复码", { exact: true }).fill(recoveryCode);
  await page.getByRole("button", { name: "验证并登录" }).click();
  await expect(page.getByText("验证失败")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "两步验证" })).toBeVisible();

  // ……然后改用验证器的码登录成功。启用时已用掉当前时间步（防重放），所以用下一步的码（服务端容忍前后各一步）
  await page.getByRole("button", { name: "改用验证器验证码" }).click();
  await page.getByLabel("验证码", { exact: true }).fill(totpAtStep(secret, enabledStep + 1));
  await page.getByRole("button", { name: "验证并登录" }).click();
  await expect(page).toHaveURL(/\/inbox$/);
});
