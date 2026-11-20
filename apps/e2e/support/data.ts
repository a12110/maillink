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
