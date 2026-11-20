import { SHARE_LINK_STATES } from "@maillink/shared";
import type { ShareLinkState } from "@maillink/shared";
import { z } from "zod";

// /admin/links 的 URL search params：只用来从别的页面带筛选进来（收件地址页的“已有链接”、规则组页的“被 N 个链接使用”）
// 以及“生成取件链接”批量入口（create_for = 逗号分隔的收件地址 id）。页面内的筛选是本地状态。
// 路由默认把纯数字参数 JSON 解析成 number，所以数字字段同时接受 string 与 number。

const blank = (value: unknown) => (value === "" || value === null ? undefined : value);
const positive = z.preprocess(blank, z.coerce.number().int().positive().safe().optional());
const text = z.preprocess(blank, z.union([z.string(), z.number()]).transform(String).optional());

const idList = z.preprocess(
  blank,
  z
    .union([z.string(), z.number()])
    .transform((value) => String(value).split(",").map((part) => Number(part.trim())))
    .pipe(z.array(z.number().int().positive().safe()).min(1))
    .optional(),
);

export const linksSearchSchema = z.object({
  mailbox_id: positive,
  rule_group_id: positive,
  state: z.preprocess(blank, z.enum(SHARE_LINK_STATES).optional()),
  order_ref: text,
  q: text,
  create_for: idList,
});
export type LinksSearch = z.output<typeof linksSearchSchema>;

/** 路由的 validateSearch：非法参数直接抛错（走路由错误页），不静默忽略 */
export function parseLinksSearch(raw: Record<string, unknown>): LinksSearch {
  const result = linksSearchSchema.safeParse(raw);
  if (result.success) return result.data;
  const detail = result.error.issues.map((issue) => `${issue.path.join(".") || "(整体)"}：${issue.message}`).join("；");
  throw new Error(`URL 筛选参数不合法（${detail}）`);
}

export type LinkFilters = {
  q: string;
  state: ShareLinkState | "";
  ruleGroupId: number | null;
  mailboxId: number | null;
  orderRef: string;
};

export const NO_LINK_FILTERS: LinkFilters = { q: "", state: "", ruleGroupId: null, mailboxId: null, orderRef: "" };

export function filtersFromSearch(search: LinksSearch): LinkFilters {
  return {
    q: search.q ?? "",
    state: search.state ?? "",
    ruleGroupId: search.rule_group_id ?? null,
    mailboxId: search.mailbox_id ?? null,
    orderRef: search.order_ref ?? "",
  };
}

export function hasLinkFilters(filters: LinkFilters): boolean {
  return JSON.stringify(filters) !== JSON.stringify(NO_LINK_FILTERS);
}
