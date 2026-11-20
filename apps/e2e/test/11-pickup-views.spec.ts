import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { ADMIN_STATE } from "../support/accounts";
import { CODE_ONLY_GROUP_NAME, requirePriorData, SEED_ADDRESSES } from "../support/data";
import { expect, test } from "../support/fixtures";
import { createLinkViaWizard } from "../support/links";
import { createFullAccessGroup } from "../support/rule-groups";
import type { GroupView } from "../support/rule-groups";

test.use({ storageState: ADMIN_STATE });

test.beforeEach(async ({ adminApi }) => {
  await requirePriorData(adminApi, { mailboxes: [SEED_ADDRESSES[0]], ruleGroups: [CODE_ONLY_GROUP_NAME] }, "04–05");
});

const ADDRESS = SEED_ADDRESSES[0];
const LOAD_OLDER_STEP_TIMEOUT_MS = 2000;
// 种子 #4（html-newsletter.eml）：主题、纯文本部分的一句话和链接
const SUBJECT = /five things worth reading/;
const PLAIN_BODY = "Read online: https://newsletter.example.com/issues/42";
const HTML_ONLY_MARKER = "this script must be stripped";

/** 买家的手机上开一个没有口令的链接，点开始取码 */
async function openAsBuyer(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.getByRole("button", { name: "开始取码" }).tap();
}

/** 列表一页放不下时，点"加载更早的邮件"直到目标出现 */
async function findInList(page: Page, target: Locator): Promise<void> {
  await expect(async () => {
    if (!(await target.isVisible())) await page.getByRole("button", { name: "加载更早的邮件" }).tap({ timeout: LOAD_OLDER_STEP_TIMEOUT_MS });
    await expect(target).toBeVisible({ timeout: LOAD_OLDER_STEP_TIMEOUT_MS });
  }).toPass();
}

async function viewLink(page: Page, view: GroupView, name: string): Promise<string> {
  await createFullAccessGroup(page, `E2E ${view}`, view);
  return (await createLinkViaWizard(page, { name, address: ADDRESS, ruleGroup: `E2E ${view}` })).path;
}

async function firstMails(api: APIRequestContext, path: string): Promise<Array<Record<string, unknown>>> {
  const response = await api.get(`/api${path}/mails`);
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { items: Array<Record<string, unknown>> }).items;
}

test("取件页 text 视图：详情是纯文本，不渲染 HTML、没有 iframe，文本里的网址不被链接化", async ({ page, openContext }) => {
  const path = await viewLink(page, "纯文本", "E2E 链接 纯文本");
  const buyer = await (await openContext({ mobile: true })).newPage();
  await openAsBuyer(buyer, path);

  const item = buyer.getByRole("button", { name: SUBJECT });
  await findInList(buyer, item);
  await item.tap();

  const detail = buyer.locator(".pk-detail");
  await expect(detail.getByText(PLAIN_BODY)).toBeVisible();
  await expect(detail.locator("iframe")).toHaveCount(0);
  // 网址只是文字：详情里没有任何 <a>，也没有 HTML 里才有的标题元素与脚本内容
  await expect(detail.locator("a")).toHaveCount(0);
  await expect(detail.getByRole("link")).toHaveCount(0);
  await expect(detail.locator("h1")).toHaveCount(0);
  await expect(detail).not.toContainText(HTML_ONLY_MARKER);

  // 对照：同一个详情栏里，带附件的邮件有下载链接 <a>——上面"没有 <a>"的断言选择器是有效的，真被链接化了会失败
  await buyer.getByRole("button", { name: "返回列表" }).tap();
  const withAttachment = buyer.getByRole("button", { name: /Your report is attached/ });
  await findInList(buyer, withAttachment);
  await withAttachment.tap();
  await expect(detail.locator("a").first()).toBeVisible();

  // 接口层面：详情只有 text，没有 html
  const items = await firstMails(buyer.context().request, path);
  const detailResponse = await buyer.context().request.get(`/api${path}/mails/${String(items[0]?.["id"])}`);
  expect(detailResponse.status()).toBe(200);
  const mail = (await detailResponse.json()) as Record<string, unknown>;
  expect(mail["text"]).toBeDefined();
  expect(mail["html"]).toBeUndefined();
});

test("取件页 meta_only 视图：只有发件人 / 主题 / 时间，没有正文、没有详情入口", async ({ page, openContext }) => {
  const path = await viewLink(page, "仅元信息", "E2E 链接 元信息");
  const buyer = await (await openContext({ mobile: true })).newPage();
  await openAsBuyer(buyer, path);

  const subject = buyer.getByText(SUBJECT);
  await findInList(buyer, subject);
  const row = buyer.locator(".pk-item").filter({ has: subject });
  await expect(row).toContainText("Example Weekly");
  await expect(row.locator(".when")).toBeVisible();
  // 没有详情入口：列表项不是按钮，页面上没有详情栏；正文里的文字（纯文本部分）不出现
  await expect(buyer.getByRole("button", { name: SUBJECT })).toHaveCount(0);
  await expect(buyer.locator(".pk-detail")).toHaveCount(0);
  await expect(buyer.locator("iframe")).toHaveCount(0);
  await expect(buyer.locator("body")).not.toContainText("Read online");

  // 接口层面：列表项没有正文字段，详情 404
  const items = await firstMails(buyer.context().request, path);
  expect(items.length).toBeGreaterThan(0);
  for (const mail of items) {
    expect(Object.keys(mail)).not.toEqual(expect.arrayContaining(["text"]));
    expect(Object.keys(mail)).not.toEqual(expect.arrayContaining(["html"]));
  }
  const detail = await buyer.context().request.get(`/api${path}/mails/${String(items[0]?.["id"])}`);
  expect(detail.status()).toBe(404);
});
