/** 只把域名部分转小写，本地部分保留原样（与 temp_email 写入 raw_mails 的规则一致） */
export function lowerDomain(address: string): string {
  const trimmed = address.trim();
  const at = trimmed.lastIndexOf("@");
  if (at < 0) return trimmed;
  return `${trimmed.slice(0, at)}@${trimmed.slice(at + 1).toLowerCase()}`;
}

/**
 * 一个地址在 MAIL_DB 里可能出现的两种写法：原样（域名小写）与全小写。
 * 同时放进 json_each 数组，既避开大小写问题，又能走 address / to_address 的索引。
 */
export function addressForms(address: string): string[] {
  return [...new Set([lowerDomain(address), address.trim().toLowerCase()])];
}

/** 多个地址的所有写法，去重 */
export function expandAddressForms(addresses: readonly string[]): string[] {
  return [...new Set(addresses.flatMap(addressForms))];
}
