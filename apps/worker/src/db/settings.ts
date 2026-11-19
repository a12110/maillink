import { loginMethodSchema } from "@maillink/shared";
import { z } from "zod";

// 系统设置读取：库里没有的键取代码默认值。键的类型与默认值只在 SETTING_DEFINITIONS 定义一次。
// 库里存 JSON 文本；值不符合 schema 说明数据被改坏，直接抛错而不是悄悄换成默认值。
// 写入与分组 API 属于 M6。

export const SETTING_DEFINITIONS = {
  "site.name": { schema: z.string().min(1), default: "MailLink" },
  "registration.enabled": { schema: z.boolean(), default: false },
  "auth.login_methods": { schema: z.array(loginMethodSchema).min(1), default: ["password"] },
} satisfies Record<string, { schema: z.ZodType; default: unknown }>;

type Definitions = typeof SETTING_DEFINITIONS;
export type SettingKey = keyof Definitions;
export type SettingValue<K extends SettingKey> = z.output<Definitions[K]["schema"]>;

type SettingRow = { key: string; value: string };

/** 一次查询读取多个设置 */
export async function getSettings<K extends SettingKey>(
  db: D1Database,
  keys: readonly K[],
): Promise<{ [P in K]: SettingValue<P> }> {
  const placeholders = keys.map(() => "?").join(", ");
  const { results } = await db
    .prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .bind(...keys)
    .all<SettingRow>();
  const stored = new Map(results.map((row) => [row.key, row.value]));

  const entries = keys.map((key) => {
    const definition = SETTING_DEFINITIONS[key];
    const text = stored.get(key);
    if (text === undefined) return [key, definition.default] as const;
    return [key, definition.schema.parse(JSON.parse(text))] as const;
  });
  return Object.fromEntries(entries) as { [P in K]: SettingValue<P> };
}
