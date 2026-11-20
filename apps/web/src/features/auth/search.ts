/** OAuth 回跳（`/login?oauth=<结果码>&provider=<slug>`、`/account?oauth=…`）带的查询参数 */
export type OAuthResultSearch = { oauth?: string; provider?: string };

const PARAM_MAX_LENGTH = 64;

function shortString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" && value.length <= PARAM_MAX_LENGTH ? value : undefined;
}

/** 路由 validateSearch：只留这两个参数，非字符串或过长的丢弃（不抛错，避免坏链接把整页变成错误页） */
export function parseOAuthResultSearch(raw: Record<string, unknown>): OAuthResultSearch {
  const oauth = shortString(raw.oauth);
  const provider = shortString(raw.provider);
  return { ...(oauth === undefined ? {} : { oauth }), ...(provider === undefined ? {} : { provider }) };
}
