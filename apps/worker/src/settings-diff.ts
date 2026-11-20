import { SETTINGS_AUDIT_VALUE_MAX_LENGTH } from "./constants";

// 设置变更写审计时的"旧值 → 新值"。只记发生变化的字段；很长的字符串（如 data URI 的 Logo）只记长度，避免撑大审计表。

export type SettingChange = { from: unknown; to: unknown };

function forAudit(value: unknown): unknown {
  if (typeof value === "string" && value.length > SETTINGS_AUDIT_VALUE_MAX_LENGTH) return `（${value.length} 个字符，已省略）`;
  return value;
}

export function diffSettings(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, SettingChange> {
  const changes: Record<string, SettingChange> = {};
  for (const field of Object.keys(after)) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      changes[field] = { from: forAudit(before[field]), to: forAudit(after[field]) };
    }
  }
  return changes;
}
