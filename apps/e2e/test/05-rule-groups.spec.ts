import { ADMIN_STATE } from "../support/accounts";
import { CODE_ONLY_GROUP_NAME, warmMailIndex } from "../support/data";
import { expect, test } from "../support/fixtures";

test.use({ storageState: ADMIN_STATE });

test("规则组：从「仅验证码」模板新建，测试器对种子邮件给出可见 / 不可见，保存后出现在列表", async ({ page, adminApi }) => {
  await warmMailIndex(adminApi);

  await page.goto("/admin/rule-groups");
  await page.getByRole("button", { name: "新建规则组" }).first().click();
  const dialog = page.getByRole("dialog", { name: "新建规则组" });
  await dialog.getByRole("radio", { name: /仅验证码/ }).check();
  await dialog.getByRole("button", { name: "用这个模板开始" }).click();
  await expect(page).toHaveURL(/\/admin\/rule-groups\/new\?template=code_only$/);

  // 模板默认只看最近 10 分钟、从创建时算起；这里改成不限时间，让种子邮件都落在范围内
  await page.getByLabel("规则组名称").fill(CODE_ONLY_GROUP_NAME);
  await page.getByLabel("滚动窗口").fill("");
  await page.getByLabel("起始锚点").selectOption({ label: "无" });

  // 测试器自动用左边未保存的配置对最近来信的地址试跑
  const tester = page.getByRole("complementary", { name: "规则测试器" });
  await expect(tester.getByLabel("收件地址或邮件 id")).toHaveValue("plain.user@example.com");
  const items = tester.locator("li.t-item");
  const visible = items.filter({ has: page.locator(".state", { hasText: /^可见$/ }) });
  const hidden = items.filter({ has: page.locator(".state", { hasText: /^不可见$/ }) });
  // 邮件 #21（"Your sign-in code"，掩码尾号之后的 908172）含验证码：可见，并提取到码
  await expect(visible.filter({ hasText: "#21" })).toContainText("908172");
  // 邮件 #13（没有验证码的送货通知）与 #8（重设密码的验证码，被"屏蔽改密"规则拦下）：不可见
  await expect(hidden.filter({ hasText: "#13" })).toHaveCount(1);
  await expect(hidden.filter({ hasText: "#8" })).toHaveCount(1);
  expect(await visible.count()).toBeGreaterThan(0);
  expect(await hidden.count()).toBeGreaterThan(0);

  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("status").getByText(`已创建规则组「${CODE_ONLY_GROUP_NAME}」`)).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/rule-groups\/\d+$/);

  await page.goto("/admin/rule-groups");
  const row = page.locator("table.rule-group-table tbody tr").filter({ hasText: CODE_ONLY_GROUP_NAME });
  await expect(row).toHaveCount(1);
  await expect(row.getByText("未被使用")).toBeVisible();
});
