import { OAUTH_FETCH_MAX_BYTES, OAUTH_FETCH_TIMEOUT_MS } from "../../constants";

// 访问 IdP 的唯一出口（发现文档、token、JWKS、userinfo）。防 SSRF：
// - 只允许 https 与默认 443 端口，URL 里不得带用户名密码；主机名不得含空标签；
// - 拒绝 IP 字面量（WHATWG URL 会把 0x7f.1、2130706433 之类规范成点分 IPv4，一并拒绝）与 IPv6 字面量；
// - 拒绝单标签主机名与内网/保留后缀（localhost、.local、.internal、.lan、.home.arpa 等）；
// - 不跟随重定向（3xx 直接失败，防止跳到内网地址）；超时与响应体大小有上限。
// 局限：Workers 里拿不到 DNS 解析结果，无法防"公网域名解析到内网 IP"（DNS rebinding）；
// Cloudflare Workers 的出站请求本身到不了部署方的内网，这一层只防显式的内网地址。

export type OutboundFailure = "url_rejected" | "redirect" | "timeout" | "too_large" | "bad_status" | "bad_json" | "network";

export class OutboundError extends Error {
  constructor(
    readonly failure: OutboundFailure,
    message: string,
  ) {
    super(message);
    this.name = "OutboundError";
  }
}

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;
const BLOCKED_SUFFIXES = [
  "localhost",
  "localdomain",
  "local",
  "internal",
  "intranet",
  "lan",
  "home",
  "home.arpa",
  "corp",
  "private",
  "arpa",
  "test",
  "invalid",
];

function rejectHost(host: string): string | null {
  if (host.startsWith("[") || host.includes(":")) return "不允许 IPv6 字面量";
  // 去掉一个表示根的结尾点后不允许再有空标签（如 localhost.. 、.example.com）
  if (host.split(".").some((label) => label === "")) return "主机名含空标签";
  if (IPV4_LITERAL.test(host)) return "不允许 IP 字面量";
  if (!host.includes(".")) return "不允许单标签主机名";
  const blocked = BLOCKED_SUFFIXES.find((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  return blocked ? `不允许内网或保留域名（.${blocked}）` : null;
}

/** 校验出站地址；不合格抛 OutboundError("url_rejected")，消息可直接展示给管理员 */
export function assertPublicHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundError("url_rejected", `不是合法的 URL：${raw}`);
  }
  if (url.protocol !== "https:") throw new OutboundError("url_rejected", `只允许 https：${raw}`);
  if (url.username || url.password) throw new OutboundError("url_rejected", "URL 不能包含用户名或密码");
  // URL 会把 :443 规范成空串，非空即非默认端口
  if (url.port !== "") throw new OutboundError("url_rejected", `只允许默认 443 端口：${raw}`);
  const reason = rejectHost(url.hostname.toLowerCase().replace(/\.$/, ""));
  if (reason) throw new OutboundError("url_rejected", `${reason}：${url.hostname}`);
  return url;
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("Content-Length") ?? "0");
  if (declared > OAUTH_FETCH_MAX_BYTES) throw new OutboundError("too_large", "响应体超过上限");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > OAUTH_FETCH_MAX_BYTES) {
      await reader.cancel();
      throw new OutboundError("too_large", "响应体超过上限");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

const HTTP_REDIRECT_MIN = 300;
const HTTP_REDIRECT_MAX = 399;

async function send(url: URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url.toString(), { ...init, redirect: "manual", signal: AbortSignal.timeout(OAUTH_FETCH_TIMEOUT_MS) });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new OutboundError(timedOut ? "timeout" : "network", `请求 ${url.host} 失败：${String(error)}`);
  }
}

/**
 * 发请求并把响应体解析为 JSON 对象。非 2xx 抛 bad_status（消息只带主机与状态码，写日志用，不透传给终端用户）。
 */
export async function fetchJson(raw: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const url = assertPublicHttpsUrl(raw);
  const response = await send(url, init);
  if (response.status >= HTTP_REDIRECT_MIN && response.status <= HTTP_REDIRECT_MAX) {
    throw new OutboundError("redirect", `${url.host} 返回重定向，出于安全考虑不跟随`);
  }
  const text = await readCapped(response);
  if (!response.ok) throw new OutboundError("bad_status", `${url.host} 返回 ${response.status}`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new OutboundError("bad_json", `${url.host} 返回的不是 JSON`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OutboundError("bad_json", `${url.host} 返回的不是 JSON 对象`);
  }
  return value as Record<string, unknown>;
}
