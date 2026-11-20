import { LINK_API_PASSWORD_HEADER, LINK_API_REQUIRED_HEADER, LINK_API_REQUIRED_HEADER_VALUE, linkApiCodePath } from "@maillink/shared";
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

/** 调用必须带的头（缺了 400、不产生副作用） */
export const API_REQUIRED_HEADER_LINE = `${LINK_API_REQUIRED_HEADER}: ${LINK_API_REQUIRED_HEADER_VALUE}`;

/** 不要把接口地址贴进聊天软件（侧板与“复制链接”里共用） */
export const API_SHARE_WARNING = `不要把接口地址贴进聊天软件；调用需带 ${API_REQUIRED_HEADER_LINE} 头。`;

/** curl 示例：总带 X-MailLink-Api 头；有口令时再带口令头（占位） */
export function curlExample(url: string, hasPassword: boolean): string {
  const password = hasPassword ? ` -H '${LINK_API_PASSWORD_HEADER}: ${API_PASSWORD_PLACEHOLDER}'` : "";
  return `curl -s -H '${API_REQUIRED_HEADER_LINE}'${password} '${url}'`;
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
