import { ADMIN_STATE, userAccount } from "../support/accounts";
import { loginWithPassword } from "../support/actions";
import { CODE_ONLY_GROUP_NAME, warmMailIndex } from "../support/data";
import { expect, test } from "../support/fixtures";

test.use({ storageState: ADMIN_STATE });

const viewer = userAccount("viewer");
const GRANTED_ADDRESS = "plain.user@example.com";
// 种子里其他收件地址的验证码：授权没给这些地址，不能出现
const OTHER_MAILBOX_CODES = ["704512", "538204", "318274"];

test("用户与授权：新建普通用户并授权 1 个地址 + 规则组，用户只看到符合规则的验证码卡片", async ({ page, adminApi, openContext }) => {
  await warmMailIndex(adminApi);

  // 管理员：新建用户
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "新建用户" }).click();
  const create = page.getByRole("dialog", { name: "新建用户" });
  await create.getByLabel("用户名").fill(viewer.username);
  await create.getByLabel("初始密码").fill(viewer.password);
  await create.getByRole("radio", { name: "普通用户" }).check();
  await create.getByRole("button", { name: "创建用户" }).click();
  await expect(page.getByRole("status").getByText(`已创建用户 ${viewer.username}`)).toBeVisible();

  // 授权 1 个收件地址，并指定规则组
  const panel = page.getByRole("complementary", { name: "用户详情" });
  await expect(panel.getByRole("heading", { name: viewer.username })).toBeVisible();
  await panel.getByRole("button", { name: "添加授权" }).click();
  const grant = page.getByRole("dialog", { name: `给 ${viewer.username} 授权邮箱` });
  await grant.getByLabel("收件地址", { exact: true }).fill("plain.user");
  await grant.getByRole("list", { name: "收件地址列表" }).getByLabel(GRANTED_ADDRESS).check();
  await grant.getByLabel("规则组").selectOption({ label: CODE_ONLY_GROUP_NAME });
  await grant.getByRole("button", { name: "授权 1 个地址" }).click();
  await expect(grant.getByText("授权完成")).toBeVisible();
  await grant.getByRole("button", { name: "完成" }).click();
  const grants = panel.getByRole("list", { name: "授权列表" });
  await expect(grants.getByText(GRANTED_ADDRESS)).toBeVisible();
  await expect(grants.getByText(`规则组：${CODE_ONLY_GROUP_NAME}`)).toBeVisible();

  // 该用户：登录后在 /inbox 只看到授权地址里符合规则的邮件
  const viewerPage = await (await openContext()).newPage();
  await loginWithPassword(viewerPage, viewer, "/inbox");
  await expect(viewerPage.getByRole("heading", { name: "我的邮件", level: 1 })).toBeVisible();
  const cards = viewerPage.locator("article.code-card");
  await expect(cards.first()).toBeVisible();
  const codes = await cards.locator(".code-card-code").allInnerTexts();
  // #21 掩码尾号之后的码、#16（ai_extract 优先）、#12（带空格的码）符合规则
  expect(codes).toEqual(expect.arrayContaining(["908172", "445566", "123456"]));
  // #14 有验证码，但正文超长被截断而模板里有正文类屏蔽规则：失败关闭，不显示（02 §5）
  expect(codes).not.toContain("246810");
  for (const other of OTHER_MAILBOX_CODES) expect(codes).not.toContain(other);
  // code_only 没有详情入口：列表里没有可点的邮件行，也没有详情栏
  await expect(viewerPage.locator(".inbox-page")).toHaveAttribute("data-detail", "none");
  await expect(viewerPage.locator("button.mail-item")).toHaveCount(0);
  await expect(viewerPage.getByRole("button", { name: "复制验证码" }).first()).toBeVisible();
  // 不符合规则的邮件（没有验证码的新闻邮件、送货通知）的内容不会出现在页面上
  await expect(viewerPage.getByText(/Example Weekly|Delivery notice/)).toHaveCount(0);

  // 接口层面同样如此：列表项只有验证码，没有正文；详情 404
  const api = viewerPage.context().request;
  const listed = (await (await api.get("/api/me/mails")).json()) as { items: Array<Record<string, unknown>> };
  expect(listed.items.length).toBeGreaterThan(0);
  for (const item of listed.items) {
    expect(item["code"]).toBeDefined();
    expect(Object.keys(item)).not.toEqual(expect.arrayContaining(["html"]));
    expect(Object.keys(item)).not.toEqual(expect.arrayContaining(["text"]));
  }
  const mailboxes = (await (await api.get("/api/me/mailboxes")).json()) as { items: Array<{ mailbox_id: number; address?: string }> };
  expect(mailboxes.items).toHaveLength(1);
  const detail = await api.get(`/api/me/mails/${String(listed.items[0]?.["id"])}?mailbox_id=${mailboxes.items[0]?.mailbox_id}`);
  expect(detail.status()).toBe(404);
});
