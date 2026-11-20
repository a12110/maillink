import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export type GroupView = "完整" | "纯文本" | "仅验证码" | "仅元信息";

/** 在 `/admin/rule-groups` 用「完整访问」模板新建规则组（不限时间、黑名单、无规则），可改视图模式 */
export async function createFullAccessGroup(page: Page, name: string, view?: GroupView): Promise<void> {
  await page.goto("/admin/rule-groups");
  await page.getByRole("button", { name: "新建规则组" }).first().click();
  await page.getByRole("dialog", { name: "新建规则组" }).getByRole("radio", { name: /完整访问/ }).check();
  await page.getByRole("button", { name: "用这个模板开始" }).click();
  await page.getByLabel("规则组名称").fill(name);
  if (view !== undefined) await page.getByRole("radio", { name: view, exact: true }).check();
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("status").getByText(`已创建规则组「${name}」`)).toBeVisible();
}
