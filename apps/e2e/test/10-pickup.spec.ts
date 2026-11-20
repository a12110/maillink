import type { Page } from "@playwright/test";
import { ADMIN_STATE } from "../support/accounts";
import { CODE_ONLY_GROUP_NAME, requirePriorData, SEED_ADDRESSES, warmMailIndex } from "../support/data";
import { expect, test } from "../support/fixtures";
import { createLinkViaWizard, openLinkPanel, settleNetwork, trackRequests } from "../support/links";
import type { CreatedLink } from "../support/links";
import { createFullAccessGroup } from "../support/rule-groups";

test.use({ storageState: ADMIN_STATE });

// 链接要绑定 04 导入的地址和 05 建的规则组；缺了立即失败，不等界面超时
test.beforeEach(async ({ adminApi }) => {
  await requirePriorData(adminApi, { mailboxes: [SEED_ADDRESSES[0]], ruleGroups: [CODE_ONLY_GROUP_NAME] }, "04–05");
});

const ADDRESS = SEED_ADDRESSES[0];
const PASSWORD = "e2e-pickup-password";
const POLL_SEC = 10;
const MS_PER_SECOND = 1000;
const ONE_POLL_MS = (POLL_SEC + 0.5) * MS_PER_SECOND;
const HALF_MINUTE_MS = 30_000;
/** 翻页找一封更早的邮件时，每一步等多久再判定"还没出现" */
const LOAD_OLDER_STEP_TIMEOUT_MS = 2000;
// 规则组 E2E 仅验证码 对 plain.user 的可见邮件里，最新的两封（见 06）
const NEWEST_CODE = "908172";
const SECOND_CODE = "445566";
const FULL_GROUP_NAME = "E2E 完整访问";
const EXPECTED_SANDBOX = "allow-popups allow-popups-to-escape-sandbox";
// HTML 里带 <b> 的说明：取件页必须按文字显示
const NOTE = "联系卖家：<b>e2e-note</b>";

function mailsOf(link: CreatedLink): string {
  return `/api/s/${link.token}/mails`;
}

/** 买家点"开始取码"（触屏） */
async function startPickup(page: Page, password?: string): Promise<void> {
  if (password !== undefined) await page.getByLabel("访问口令").fill(password);
  await page.getByRole("button", { name: "开始取码" }).tap();
}

// 链接 A 的三个用例前后依赖（买家用尽它、最后一个用例看它已失效），一起串行；其余用例各建各的链接，互不牵连
test.describe("链接 A：创建 → 买家取码 → 用尽后的页面", () => {
  test.describe.configure({ mode: "serial" });
  let linkA: CreatedLink;

  test("创建：向导建链接（口令、1 台设备、总次数 2 自动切为点击取码），完整链接只在结果页出现一次", async ({ page, adminApi }) => {
    await warmMailIndex(adminApi);
    linkA = await createLinkViaWizard(page, {
      name: "E2E 链接 A",
      address: ADDRESS,
      ruleGroup: CODE_ONLY_GROUP_NAME,
      publicTitle: "E2E 共享号",
      publicNote: NOTE,
      password: PASSWORD,
      maxDevices: 1,
      maxTotal: 2,
      pollIntervalSec: POLL_SEC,
    });

    // 关闭结果页后：列表里有这条链接，但页面（DOM、存储）里不再有完整 token
    const row = page.locator("table tbody tr").filter({ hasText: "E2E 链接 A" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(ADDRESS);
    await expect(row).toContainText("生效中");
    expect(await page.content()).not.toContain(linkA.token);
  expect(page.url()).not.toContain(linkA.token);
  expect(await page.title()).not.toContain(linkA.token);
    const stored = await page.evaluate(() => JSON.stringify([{ ...sessionStorage }, { ...localStorage }]));
    expect(stored).not.toContain(linkA.token);
  });

  test("买家：口令、点击取码与剩余次数；第二台设备被挡；总次数用尽后停止刷新", async ({ openContext }) => {
    const buyer = await openContext({ mobile: true });
    const page = await buyer.newPage();
    await page.clock.install();
    const mails = trackRequests(page, mailsOf(linkA));
    await page.goto(linkA.path);

    await test.step("口令通过前：只有标题与卖家说明，没有收件地址，标题里没有 token", async () => {
      await expect(page.getByRole("heading", { name: "E2E 共享号" })).toBeVisible();
      await expect(page.getByText(NOTE)).toBeVisible();
      await expect(page.locator(".pk-lead b")).toHaveCount(0);
      await expect(page.locator(".pk-addr")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("plain.user");
      expect(await page.title()).toContain("E2E 共享号");
      expect(await page.title()).not.toContain(linkA.token);
    });

    await test.step("错误口令就地提示，仍然没有地址", async () => {
      await startPickup(page, "wrong-password");
      await expect(page.getByText("访问口令不正确")).toBeVisible();
      await expect(page.locator(".pk-addr")).toHaveCount(0);
    });

    await test.step("正确口令：打码地址出现，邮件内容在点击之前不显示", async () => {
      await startPickup(page, PASSWORD);
      const address = page.locator(".pk-addr");
      await expect(address).toBeVisible();
      await expect(address).not.toHaveText(ADDRESS);
      await expect(address).toContainText("@example.com");
      await expect(page.getByRole("button", { name: "查看验证码（剩余 2 次）" })).toBeVisible();
      await expect(page.locator("body")).not.toContainText(NEWEST_CODE);
    });

    await test.step("还在轮询：推进一个间隔，多一次 /mails 请求", async () => {
      const before = mails.count();
      await page.clock.runFor(ONE_POLL_MS);
      await settleNetwork(page);
      expect(mails.count()).toBeGreaterThan(before);
    });

    await test.step("第 1 次点取：得到最新的验证码，剩余次数递减", async () => {
      await page.getByRole("button", { name: "查看验证码（剩余 2 次）" }).tap();
      await expect(page.locator(".pk-code")).toHaveText(NEWEST_CODE);
      await expect(page.getByText("（剩余 1 次）")).toBeVisible();
    });

    await test.step("另一个隔离上下文（另一台设备）：设备已满，看不到地址与验证码", async () => {
      const other = await (await openContext({ mobile: true })).newPage();
      await other.goto(linkA.path);
      await expect(other.getByRole("heading", { name: "这个链接已在其他设备上使用" })).toBeVisible();
      await expect(other.getByText("最多可在 1 台设备上使用")).toBeVisible();
      await expect(other.getByText(NOTE)).toBeVisible();
      await expect(other.locator(".pk-addr")).toHaveCount(0);
      await expect(other.locator("body")).not.toContainText(NEWEST_CODE);
    });

    await test.step("第 2 次点取：两个码都在，总次数用尽，停止刷新且不再请求 /mails", async () => {
      await page.locator(".pk-old").getByRole("button", { name: "查看" }).tap();
      await expect(page.getByText("取码次数已用完，已停止刷新")).toBeVisible();
      await expect(page.locator(".pk-code")).toHaveText(NEWEST_CODE);
      await expect(page.locator(".pk-old .code[aria-label]")).toHaveText(SECOND_CODE);
      const before = mails.count();
      await page.clock.runFor(HALF_MINUTE_MS);
      await settleNetwork(page);
      expect(mails.count()).toBe(before);
      await expect(page.locator(".pk-code")).toHaveText(NEWEST_CODE);
    });
  });

  test("取件页其他约束：/S/ 大写不是取件页、不请求 setup、响应头 no-store 与 noindex、标题不含 token", async ({ openContext }) => {
    const page = await (await openContext({ mobile: true })).newPage();
    const setup = trackRequests(page, "/api/setup/status");
    const pickupApi = trackRequests(page, "/api/s/");

    const response = await page.goto(linkA.path);
    const headers = response?.headers() ?? {};
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["x-robots-tag"]).toMatch(/noindex/);
    // 链接 A 的总次数已用完：新访客看到的是统一的"已失效"
    await expect(page.getByRole("heading", { name: "链接已失效" })).toBeVisible();
    expect(await page.title()).not.toContain(linkA.token);
    expect(pickupApi.count()).toBeGreaterThan(0);
    expect(setup.count()).toBe(0);

    // 大小写不同的路径不是取件页：页面不存在，且没有请求取件接口
    const before = pickupApi.count();
    await page.goto(linkA.path.replace("/s/", "/S/"));
    await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
    expect(pickupApi.count()).toBe(before);
    expect(await page.title()).not.toContain(linkA.token);
  });
});

test("仅每日次数用尽：显示恢复时间与「不是链接失效」，码保留，继续轮询", async ({ page, openContext }) => {
  const link = await createLinkViaWizard(page, { name: "E2E 链接 B 每日", address: ADDRESS, ruleGroup: CODE_ONLY_GROUP_NAME, maxPerDay: 1, pollIntervalSec: POLL_SEC });

  const buyer = await (await openContext({ mobile: true })).newPage();
  await buyer.clock.install();
  const mails = trackRequests(buyer, mailsOf(link));
  await buyer.goto(link.path);
  await startPickup(buyer);
  await buyer.getByRole("button", { name: "查看验证码（剩余 1 次）" }).tap();

  await expect(buyer.locator(".pk-code")).toHaveText(NEWEST_CODE);
  const notice = buyer.getByText("今天的次数用完了", { exact: true });
  await expect(notice).toBeVisible();
  await expect(buyer.getByText("到时恢复 1 次")).toBeVisible();
  await expect(buyer.getByText("这不是链接失效")).toBeVisible();
  await expect(buyer.getByText("已停止刷新")).toHaveCount(0);
  await expect(buyer.getByText("链接已失效")).toHaveCount(0);

  // 只是每日上限：轮询照旧，已取到的码仍在页面上
  const before = mails.count();
  await buyer.clock.runFor(ONE_POLL_MS);
  await expect.poll(() => mails.count()).toBeGreaterThan(before);
  await expect(buyer.locator(".pk-code")).toHaveText(NEWEST_CODE);
  await expect(notice).toBeVisible();
});

test("撤销：管理端二次确认后，买家刷新显示「已失效」，页面不出现撤销原因", async ({ page, openContext }) => {
  const name = "E2E 链接 C 撤销";
  const link = await createLinkViaWizard(page, { name, address: ADDRESS, ruleGroup: CODE_ONLY_GROUP_NAME, publicTitle: "E2E 撤销用" });

  const buyer = await (await openContext({ mobile: true })).newPage();
  await buyer.goto(link.path);
  await startPickup(buyer);
  await expect(buyer.locator(".pk-code")).toHaveText(NEWEST_CODE);

  const panel = await openLinkPanel(page, name);
  await panel.getByRole("button", { name: "撤销", exact: true }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByText("撤销是终态，不可恢复")).toBeVisible();
  await confirm.getByRole("button", { name: "撤销链接" }).click();
  await expect(page.getByRole("status").getByText("已撤销（1 条）")).toBeVisible();
  await expect(page.locator("table tbody tr").filter({ hasText: name })).toContainText("已撤销");

  await buyer.reload();
  await expect(buyer.getByRole("heading", { name: "链接已失效" })).toBeVisible();
  await expect(buyer.locator("body")).not.toContainText(/撤销|revoked|已暂停|已过期/);
  await expect(buyer.locator(".pk-code")).toHaveCount(0);
});

test("页面开着时链接被暂停：买家页收到 410 后停止轮询、保留已显示的码", async ({ page, openContext }) => {
  const name = "E2E 链接 E 暂停";
  const link = await createLinkViaWizard(page, { name, address: ADDRESS, ruleGroup: CODE_ONLY_GROUP_NAME, pollIntervalSec: POLL_SEC });

  const buyer = await (await openContext({ mobile: true })).newPage();
  await buyer.clock.install();
  const mails = trackRequests(buyer, mailsOf(link));
  await buyer.goto(link.path);
  await startPickup(buyer);
  await expect(buyer.locator(".pk-code")).toHaveText(NEWEST_CODE);

  // 正向对照：暂停之前，推进一个间隔就多一次请求
  const beforePause = mails.count();
  await buyer.clock.runFor(ONE_POLL_MS);
  await expect.poll(() => mails.count()).toBeGreaterThan(beforePause);

  const panel = await openLinkPanel(page, name);
  await panel.getByRole("button", { name: "暂停" }).click();
  await expect(page.getByRole("status").getByText("已暂停（1 条）")).toBeVisible();

  // 买家页还开着：下一次轮询拿到 410（对买家统一是"已失效"），停止刷新，已显示的码保留
  await buyer.clock.runFor(ONE_POLL_MS);
  await expect(buyer.getByText("链接已失效，已停止刷新")).toBeVisible();
  await expect(buyer.locator(".pk-code")).toHaveText(NEWEST_CODE);
  await expect(buyer.locator("body")).not.toContainText(/暂停|paused/);
  await settleNetwork(buyer);
  const stopped = mails.count();
  await buyer.clock.runFor(HALF_MINUTE_MS);
  await settleNetwork(buyer);
  expect(mails.count()).toBe(stopped);
  await expect(buyer.locator(".pk-code")).toHaveText(NEWEST_CODE);
});

test("完整邮件视图：取件页详情的 HTML 在沙箱 iframe 里，sandbox 精确", async ({ page, openContext }) => {
  await createFullAccessGroup(page, FULL_GROUP_NAME);
  const link = await createLinkViaWizard(page, { name: "E2E 链接 D 完整", address: ADDRESS, ruleGroup: FULL_GROUP_NAME });

  const buyer = await (await openContext({ mobile: true })).newPage();
  await buyer.goto(link.path);
  await startPickup(buyer);
  const newsletter = buyer.getByRole("button", { name: /five things worth reading/ });
  await expect(async () => {
    if (!(await newsletter.isVisible())) await buyer.getByRole("button", { name: "加载更早的邮件" }).tap({ timeout: LOAD_OLDER_STEP_TIMEOUT_MS });
    await expect(newsletter).toBeVisible({ timeout: LOAD_OLDER_STEP_TIMEOUT_MS });
  }).toPass();
  await newsletter.tap();

  const frame = buyer.locator(".pk-detail iframe");
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("sandbox", EXPECTED_SANDBOX);
  await expect(buyer.frameLocator(".pk-detail iframe").getByRole("heading", { name: "Example Weekly" })).toBeVisible();
  const srcdoc = (await frame.getAttribute("srcdoc")) ?? "";
  expect(srcdoc).not.toMatch(/<script/i);
  expect(srcdoc).not.toContain("tracker.example.com");
});
