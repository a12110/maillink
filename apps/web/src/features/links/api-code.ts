import { LINK_API_PASSWORD_HEADER, linkApiCodePath } from "@maillink/shared";
import type { LinkAccessInput, LinkAccessView } from "@maillink/shared";

// API 取码（GET /api/s/<token>/code）在管理端的展示：接口地址、curl 示例、开关的请求体。

/** 侧板里不显示完整 token（只在“复制链接”里出现），用占位 */
export const API_TOKEN_PLACEHOLDER = "<token>";
export const API_PASSWORD_PLACEHOLDER = "<口令>";

/** 管理端与取件页同源（写请求的 Origin 必须等于 PUBLIC_ORIGIN），所以 origin 就是 PUBLIC_ORIGIN */
export function apiCodeUrl(origin: string, token: string): string {
  return `${origin}${linkApiCodePath(token)}`;
}

const LINK_PATH = /^\/s\/([^/?#]+)$/u;

/** 完整取件链接 `<origin>/s/<token>` → 接口地址；不是这个形态时返回 null */
export function apiCodeUrlFromLink(linkUrl: string): string | null {
  const url = new URL(linkUrl);
  const token = LINK_PATH.exec(url.pathname)?.[1];
  return token === undefined ? null : apiCodeUrl(url.origin, token);
}

/** curl 示例：有口令时带口令头（占位） */
export function curlExample(url: string, hasPassword: boolean): string {
  const header = hasPassword ? ` -H '${LINK_API_PASSWORD_HEADER}: ${API_PASSWORD_PLACEHOLDER}'` : "";
  return `curl -s${header} '${url}'`;
}

/**
 * PATCH 的 access 是整体替换：从当前视图原样带回其余约束，只改 api；不带 password（服务端保留原口令哈希）。
 */
export function accessWithApi(access: LinkAccessView, api: boolean): LinkAccessInput {
  return {
    turnstile: access.turnstile,
    max_devices: access.max_devices,
    reveal: access.reveal,
    max_deliveries_total: access.max_deliveries_total,
    max_deliveries_per_day: access.max_deliveries_per_day,
    ip_allow: access.ip_allow,
    country_allow: access.country_allow,
    poll_interval_sec: access.poll_interval_sec,
    api,
  };
}
