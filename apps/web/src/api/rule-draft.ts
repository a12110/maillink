import { ruleSchema } from "@maillink/shared";
import { z } from "zod";

// POST /api/admin/rule-groups/draft-from-mail 的响应。形状来自 apps/worker/src/rules/draft.ts 的 RuleDraft，
// shared 里还没有这个 schema，先在前端声明；响应不符合时按契约破坏处理（ResponseFormatError）。
export const ruleDraftSchema = z.object({
  /** 既没有可用的发件人域名也没有主题时为 null */
  rule: ruleSchema.nullable(),
  subject_pattern: z.string().nullable(),
  code_regex: z.string().nullable(),
  /** 给管理员看的说明：泛化了什么、哪里需要人工确认 */
  notes: z.array(z.string()),
});
export type RuleDraft = z.infer<typeof ruleDraftSchema>;
