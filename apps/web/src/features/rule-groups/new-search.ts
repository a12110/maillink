import { z } from "zod";

// /admin/rule-groups/new 的 URL 参数：template（内置模板 key 或 blank）与 from_mail（以此邮件创建规则）。
// 路由默认把纯数字参数解析成 number，所以 from_mail 同时接受数字与字符串。

const blankToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value);

export const newRuleGroupSearchSchema = z.object({
  template: z.preprocess(blankToUndefined, z.string().max(64).optional()),
  from_mail: z.preprocess(blankToUndefined, z.coerce.number().int().positive().safe().optional()),
});
export type NewRuleGroupSearch = z.output<typeof newRuleGroupSearchSchema>;

/** 路由的 validateSearch：非法参数直接抛错（走路由错误页），不静默忽略 */
export function parseNewRuleGroupSearch(raw: Record<string, unknown>): NewRuleGroupSearch {
  const result = newRuleGroupSearchSchema.safeParse(raw);
  if (result.success) return result.data;
  const detail = result.error.issues.map((issue) => `${issue.path.join(".") || "(整体)"}：${issue.message}`).join("；");
  throw new Error(`URL 参数不合法（${detail}）`);
}
