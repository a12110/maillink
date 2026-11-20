import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";

/** 种子（apps/worker/scripts/seed-mail-db.ts）里出现过的 to_address，一共 4 个 */
export const SEED_ADDRESSES = [
  "plain.user@example.com",
  "zh.user@example.com",
  "ja.user@example.com",
  "hme.alias.7k2@icloud.com",
] as const;

/** 用例里创建的规则组：只显示含验证码的邮件（code_only），不限时间窗，没有起始锚点 */
export const CODE_ONLY_GROUP_NAME = "E2E 仅验证码";

const SEED_MAIL_COUNT = 22;
const WARM_TIMEOUT_MS = 30_000;

/**
 * 邮件列表第一次请求时才解析 MIME（懒构建），未解析完的邮件 partial=true、状态 pending。
 * 用例开始前轮询到全部解析完，之后页面上的邮件主题、验证码、规则判定都是确定的。
 */
export async function warmMailIndex(adminApi: APIRequestContext): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await adminApi.get("/api/admin/mails?limit=100");
        const body = (await response.json()) as { items: Array<{ parse_status: string }>; partial: boolean };
        return { count: body.items.length, pending: body.items.filter((item) => item.parse_status === "pending").length, partial: body.partial };
      },
      { message: "等待种子邮件解析完成", timeout: WARM_TIMEOUT_MS },
    )
    .toEqual({ count: SEED_MAIL_COUNT, pending: 0, partial: false });
}

export type PriorData = {
  /** 已导入的收件地址 */
  mailboxes?: readonly string[];
  /** 规则组名称 */
  ruleGroups?: readonly string[];
  /** 用户名 */
  users?: readonly string[];
};

async function namesOf(adminApi: APIRequestContext, path: string, key: string): Promise<Set<string>> {
  const response = await adminApi.get(path);
  expect(response.ok(), `读取 ${path}：${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as { items: Array<Record<string, unknown>> };
  return new Set(body.items.map((item) => String(item[key])));
}

/**
 * 依赖前序用例创建的数据时，开头先确认它们都在：缺了立即失败并说明原因，
 * 而不是等到界面上某个元素 60 秒超时。`source` 是创建这些数据的文件，如 "04–06"。
 */
export async function requirePriorData(adminApi: APIRequestContext, needs: PriorData, source: string): Promise<void> {
  const missing: string[] = [];
  const checks: Array<[readonly string[] | undefined, string, string, string]> = [
    [needs.mailboxes, "/api/admin/mailboxes?limit=100", "address", "收件地址"],
    [needs.ruleGroups, "/api/admin/rule-groups", "name", "规则组"],
    [needs.users, "/api/admin/users?limit=100", "username", "用户"],
  ];
  for (const [wanted, path, key, label] of checks) {
    if (wanted === undefined) continue;
    const present = await namesOf(adminApi, path, key);
    missing.push(...wanted.filter((name) => !present.has(name)).map((name) => `${label} ${name}`));
  }
  if (missing.length > 0) {
    throw new Error(`缺少前序用例创建的数据：${missing.join("、")}。本文件依赖 ${source} 创建的数据，请全量运行 \`pnpm e2e\`（不要单独运行本文件）。`);
  }
}
