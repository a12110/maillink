import { MAIL_LINKS_MAX_COUNT, MAIL_LINK_MAX_LENGTH } from "../constants";
import { normalizeText } from "./normalize";

// 链接提取：正文里的 URL 与 HTML 的 <a href>，去重（01 §4.1）。
// `links` 有数量与长度上限，但 `domains` 由**全部**可解析的 http(s) 链接派生、不受上限影响：
// 否则先塞满无害链接，或把恶意链接补长，就能让 link.domains 类 deny 规则看不到它。

/** URL 不含空白、尖括号、引号，也不含 CJK 标点与全角符号（NFKC 之后全角 ASCII 已变成半角） */
const URL_PATTERN = /https?:\/\/[^\s<>"'`\u3000-\u303F\uFF00-\uFFEF]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>'"]+$/;
const HTTP_URL = /^https?:\/\/\S+$/i;

export type LinkExtract = {
  /** 受数量与长度上限约束，按 href 在前、正文在后的顺序 */
  links: string[];
  /** 全部可解析链接的域名：全小写、去重 */
  domains: string[];
};

/** 是 http(s) 且可解析时返回 { link, host }，否则 null（不检查长度） */
function parseHttpLink(candidate: string): { link: string; host: string } | null {
  const link = candidate.replace(TRAILING_PUNCTUATION, "");
  if (!HTTP_URL.test(link)) return null;
  try {
    return { link, host: new URL(link).hostname.toLowerCase() };
  } catch {
    return null;
  }
}

export function extractLinks(body: string, hrefs: readonly string[]): LinkExtract {
  const candidates = [
    ...hrefs.map((href) => normalizeText(href)),
    ...(body.match(URL_PATTERN) ?? []),
  ];
  const links = new Set<string>();
  const domains = new Set<string>();
  for (const candidate of candidates) {
    const parsed = parseHttpLink(candidate);
    if (!parsed) continue;
    domains.add(parsed.host);
    if (links.size < MAIL_LINKS_MAX_COUNT && parsed.link.length <= MAIL_LINK_MAX_LENGTH) links.add(parsed.link);
  }
  return { links: [...links], domains: [...domains] };
}
