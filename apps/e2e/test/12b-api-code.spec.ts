import { ADMIN_STATE } from "../support/accounts";
import { ORIGIN } from "../support/env";
import { CODE_ONLY_GROUP_NAME, requirePriorData, SEED_ADDRESSES, warmMailIndex } from "../support/data";
import { expect, test } from "../support/fixtures";
import { createLinkViaWizard, openLinkPanel } from "../support/links";

// API 取码 GET /api/s/<token>/code：向导建链接（默认允许 API）→ 不带任何 Cookie 调接口取到种子验证码 → 计次反映到管理端。
// 只用已保存的管理员会话，不新增登录。

test.use({ storageState: ADMIN_STATE });

test.beforeEach(async ({ adminApi }) => {
  await requirePriorData(adminApi, { mailboxes: [SEED_ADDRESSES[0]], ruleGroups: [CODE_ONLY_GROUP_NAME] }, "04–05");
});

// 规则组 E2E 仅验证码 对 plain.user 可见的最新一封（见 10-pickup）
const NEWEST_CODE = "908172";
const NAME = "E2E 链接 API 取码";

type CodeBody = { status: string; code: string | null; mail_id: number | null; remaining: { total: number | null; today: number | null } | null; items: unknown[] };

test("API 取码：建链接 → 接口取到种子验证码 → 同一封不重复计次 → 管理端看到 1 次取码与 API 设备", async ({ page, adminApi, playwright }) => {
  await warmMailIndex(adminApi);
  const link = await createLinkViaWizard(page, { name: NAME, address: SEED_ADDRESSES[0], ruleGroup: CODE_ONLY_GROUP_NAME, maxTotal: 3, api: true });

  // 脚本视角：全新的请求上下文，没有任何 Cookie
  const script = await playwright.request.newContext({ baseURL: ORIGIN });
  const call = async () => {
    const response = await script.get(`/api/s/${link.token}/code`);
    expect(response.status(), await response.text()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["set-cookie"]).toBeUndefined();
    return (await response.json()) as CodeBody;
  };
  const first = await call();
  expect(first).toMatchObject({ status: "ok", code: NEWEST_CODE, remaining: { total: 2, today: null } });
  expect(JSON.stringify(first)).not.toContain(link.token);
  const again = await call();
  expect(again).toMatchObject({ code: NEWEST_CODE, mail_id: first.mail_id, remaining: { total: 2, today: null } });
  const future = await script.get(`/api/s/${link.token}/code?since=${Math.floor(Date.now() / 1000) + 3600}`);
  expect(((await future.json()) as CodeBody).status).toBe("no_code");
  await script.dispose();

  // 管理端：累计取码 1、设备 1（接口占的那台），侧板给出接口地址（token 占位）与 curl 示例
  const panel = await openLinkPanel(page, NAME);
  const stat = (label: string) => panel.locator("dt", { hasText: new RegExp(`^${label}$`, "u") }).locator("xpath=following-sibling::dd[1]");
  await expect(stat("累计取码")).toHaveText("1");
  await expect(stat("设备数")).toHaveText("1");
  const api = panel.locator("section", { has: page.getByRole("heading", { name: "API 取码" }) });
  await expect(api.getByRole("switch", { name: "允许 API 取码" })).toBeChecked();
  await expect(api).toContainText("/api/s/<token>/code");
  await expect(api.getByLabel("curl 示例")).toContainText("curl -s");
  expect(await page.content()).not.toContain(link.token);
});
