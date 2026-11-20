import { ADMIN_STATE } from "../support/accounts";
import { SEED_ADDRESSES } from "../support/data";
import { expect, test } from "../support/fixtures";

test.use({ storageState: ADMIN_STATE });

const IMPORT_TAG = "e2e-seed";
// 06 §8 的列序：地址, 平台, 备注；平台列映射成标签
const PLATFORM_TAG = "Steam";
const PLATFORM_NOTE = "日文样本, 带逗号";

test("收件地址：两步对话框导入种子地址，预览区分新增 / 重复 / 无效，列表计数正确", async ({ page, adminApi }) => {
  await page.goto("/admin/mailboxes");
  await expect(page.getByText("还没有收件地址")).toBeVisible();

  await page.getByRole("button", { name: "导入", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入收件地址" });
  // 4 个种子地址（其中一行带平台与备注列）+ 1 行重复（大小写不同）+ 1 行无效
  const seedLines = SEED_ADDRESSES.map((address, index) => (index === 2 ? `${address},${PLATFORM_TAG},"${PLATFORM_NOTE}"` : address));
  const lines = [...seedLines, SEED_ADDRESSES[0].toUpperCase(), "not-an-email"];
  await dialog.getByLabel("地址列表").fill(lines.join("\n"));
  await dialog.getByRole("textbox", { name: "本次导入的标签" }).fill(IMPORT_TAG);
  await dialog.getByRole("textbox", { name: "本次导入的标签" }).press("Enter");
  await dialog.getByRole("button", { name: "预览导入结果" }).click();

  // 第 2 步：预览。此时还没有写入任何数据
  const counts = dialog.getByLabel("预览结果");
  await expect(counts.locator("div", { hasText: "新增" }).locator("dd")).toHaveText(String(SEED_ADDRESSES.length));
  await expect(counts.locator("div", { hasText: "重复" }).locator("dd")).toHaveText("1");
  await expect(counts.locator("div", { hasText: "无效" }).locator("dd")).toHaveText("1");
  const confirm = dialog.getByRole("button", { name: `导入 ${SEED_ADDRESSES.length} 个新地址` });
  await confirm.click();

  await expect(page.getByRole("status").getByText(`已导入 ${SEED_ADDRESSES.length} 个地址`)).toBeVisible();
  await expect(dialog).toBeHidden();

  // 列表与页头计数
  await expect(page.getByText(/^共\s*4\s*个地址/)).toBeVisible();
  const rows = page.locator("table.mailbox-table tbody tr");
  await expect(rows).toHaveCount(SEED_ADDRESSES.length);
  for (const address of SEED_ADDRESSES) await expect(rows.filter({ hasText: address })).toHaveCount(1);
  await expect(rows.first().getByText(IMPORT_TAG)).toBeVisible();
  const listed = (await (await adminApi.get("/api/admin/mailboxes?limit=100")).json()) as { items: Array<{ address: string; note: string | null; tags: string[] }> };
  const withPlatform = listed.items.find((item) => item.address === SEED_ADDRESSES[2]);
  expect(withPlatform?.note).toBe(PLATFORM_NOTE);
  expect([...(withPlatform?.tags ?? [])].sort()).toEqual([IMPORT_TAG, PLATFORM_TAG].sort());
  expect(listed.items.find((item) => item.address === SEED_ADDRESSES[0])).toMatchObject({ note: null, tags: [IMPORT_TAG] });
  await expect(page.getByRole("button", { name: /启用\s*4$/ })).toBeVisible();
  await expect(page.getByText(`第 1–4 行，共 4 行`)).toBeVisible();

  // 再导入同样的地址：全部是重复，没有可导入的新地址
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await page.getByRole("dialog", { name: "导入收件地址" }).getByLabel("地址列表").fill(SEED_ADDRESSES[0]);
  await page.getByRole("button", { name: "预览导入结果" }).click();
  await expect(page.getByRole("button", { name: "没有可导入的新地址" })).toBeDisabled();
});
