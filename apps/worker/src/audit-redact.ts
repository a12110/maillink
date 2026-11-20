// 审计 detail 返回前的兜底脱敏：写入方本来就不该放秘密，这里防止以后有人放了而被列表接口原样吐出。

/** 键名（不区分大小写，子串匹配）含这些片段的整项剔除。宁可多剔：丢一个 error_code 远比泄露一个验证码轻 */
const SENSITIVE_KEY_PATTERN = /password|passwd|passphrase|token|secret|credential|authorization|cookie|recovery|code/i;

/** 递归剔除敏感键（对象与数组内都处理）；不修改入参，返回新值 */
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (typeof value !== "object" || value === null) return value;
  const kept = Object.entries(value).filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key));
  return Object.fromEntries(kept.map(([key, inner]) => [key, redactSensitive(inner)]));
}
