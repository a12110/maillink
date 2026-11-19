import type { z } from "zod";

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** zod 校验失败 → 按字段名的错误文案（每个字段取第一条），字段名不在 keys 里的落到 `form` */
export function fieldErrorsFromZod<K extends string>(
  error: z.ZodError,
  keys: readonly K[],
): { fields: FieldErrors<K>; form: string | null } {
  const fields: FieldErrors<K> = {};
  const formMessages: string[] = [];
  for (const issue of error.issues) {
    const head = issue.path[0];
    const key = keys.find((k) => k === head);
    if (key === undefined) formMessages.push(issue.message);
    else if (fields[key] === undefined) fields[key] = issue.message;
  }
  return { fields, form: formMessages.length > 0 ? formMessages.join("；") : null };
}
