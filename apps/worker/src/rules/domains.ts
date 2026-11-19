import { domainIs, normalizeDomain } from "@maillink/shared";

// 域名匹配（domain_is 语义）与 URL 主机提取。
// 国际化域名：邮件地址里可能是 Unicode 写法，URL 的 hostname 是 punycode；规则值与候选都同时比较两种写法。

const ASCII_ONLY = /^\p{ASCII}*$/u;

/** Unicode 域名转 punycode；不合法时返回 null */
export function toAsciiDomain(domain: string): string | null {
  if (ASCII_ONLY.test(domain)) return domain;
  try {
    return new URL(`http://${domain}`).hostname.replace(/\.$/u, "");
  } catch {
    return null;
  }
}

/** 把规则里的域名列表编译成归一化后的写法集合（含 punycode） */
export function compileDomainList(values: readonly string[]): string[] {
  const result = new Set<string>();
  for (const value of values) {
    const domain = normalizeDomain(value);
    result.add(domain);
    const ascii = toAsciiDomain(domain);
    if (ascii !== null) result.add(ascii);
  }
  return [...result];
}

/** 候选域名是否落在列表内（domain_is）；返回命中的规则域名，未命中返回 null */
export function matchDomain(candidate: string, compiled: readonly string[]): string | null {
  const normalized = normalizeDomain(candidate);
  const ascii = toAsciiDomain(normalized);
  for (const ruleDomain of compiled) {
    if (domainIs(normalized, ruleDomain) || (ascii !== null && domainIs(ascii, ruleDomain))) return ruleDomain;
  }
  return null;
}

/** 只接受 http / https 的绝对 URL */
export function parseHttpUrl(text: string): URL | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url : null;
}

/** URL 的主机名（小写、去末尾点） */
export function urlHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/u, "");
}
