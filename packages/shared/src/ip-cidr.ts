// IPv4 / IPv6 地址与 CIDR 的解析与匹配（取件链接的 ip_allow，02 §6）。前端表单校验与 worker 运行时共用。
// 只接受规范写法：IPv4 四段十进制、无前导零；IPv6 允许 `::` 压缩与末尾内嵌 IPv4，不接受 zone id（%eth0）。

export type IpVersion = 4 | 6;
export type ParsedIp = { version: IpVersion; bytes: Uint8Array };
export type ParsedCidr = ParsedIp & { prefix: number };

const IPV4_BYTES = 4;
const IPV6_BYTES = 16;
const IPV6_GROUPS = 8;
const BYTE_MAX = 255;
const BITS_PER_BYTE = 8;
const IPV4_DECIMAL = /^(?:0|[1-9]\d{0,2})$/u;
const IPV6_GROUP = /^[0-9a-f]{1,4}$/iu;
const PREFIX_PATTERN = /^(?:0|[1-9]\d{0,2})$/u;
/** ::ffff:0:0/96 前缀：IPv4 映射地址按 IPv4 匹配 */
const MAPPED_PREFIX = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff];

export function parseIpv4(text: string): Uint8Array | null {
  const parts = text.split(".");
  if (parts.length !== IPV4_BYTES) return null;
  const bytes = new Uint8Array(IPV4_BYTES);
  for (const [index, part] of parts.entries()) {
    if (!IPV4_DECIMAL.test(part)) return null;
    const value = Number(part);
    if (value > BYTE_MAX) return null;
    bytes[index] = value;
  }
  return bytes;
}

/** 内嵌 IPv4 → 两个 16 位分组 */
function ipv4Groups(text: string): number[] | null {
  const v4 = parseIpv4(text);
  if (v4 === null) return null;
  const [a = 0, b = 0, c = 0, d = 0] = v4;
  return [(a << BITS_PER_BYTE) | b, (c << BITS_PER_BYTE) | d];
}

/** 一侧（`::` 左边或右边）的分组 → 16 位整数；末尾允许一段内嵌 IPv4（占两组） */
function parseIpv6Side(text: string, allowTrailingIpv4: boolean): number[] | null {
  if (text === "") return [];
  const groups = text.split(":");
  const last = groups.at(-1) ?? "";
  const trailing = allowTrailingIpv4 && last.includes(".") ? ipv4Groups(last) : [];
  if (trailing === null) return null;
  const hexGroups = trailing.length > 0 ? groups.slice(0, -1) : groups;
  if (!hexGroups.every((group) => IPV6_GROUP.test(group))) return null;
  return [...hexGroups.map((group) => Number.parseInt(group, 16)), ...trailing];
}

export function parseIpv6(text: string): Uint8Array | null {
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = parseIpv6Side(halves[0] ?? "", halves.length === 1);
  const tail = halves.length === 2 ? parseIpv6Side(halves[1] ?? "", true) : [];
  if (head === null || tail === null) return null;
  const missing = IPV6_GROUPS - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...new Array<number>(halves.length === 1 ? 0 : missing).fill(0), ...tail];
  const bytes = new Uint8Array(IPV6_BYTES);
  groups.forEach((group, index) => {
    bytes[index * 2] = group >> BITS_PER_BYTE;
    bytes[index * 2 + 1] = group & BYTE_MAX;
  });
  return bytes;
}

export function parseIp(text: string): ParsedIp | null {
  const trimmed = text.trim();
  if (trimmed.includes(":")) {
    const bytes = parseIpv6(trimmed);
    return bytes === null ? null : { version: 6, bytes };
  }
  const bytes = parseIpv4(trimmed);
  return bytes === null ? null : { version: 4, bytes };
}

/** `地址/前缀`；不带前缀表示单个地址（/32 或 /128） */
export function parseCidr(text: string): ParsedCidr | null {
  const [address, prefixText, ...rest] = text.trim().split("/");
  if (rest.length > 0 || address === undefined) return null;
  const ip = parseIp(address);
  if (ip === null) return null;
  const maxPrefix = ip.bytes.length * BITS_PER_BYTE;
  if (prefixText === undefined) return { ...ip, prefix: maxPrefix };
  if (!PREFIX_PATTERN.test(prefixText)) return null;
  const prefix = Number(prefixText);
  return prefix > maxPrefix ? null : { ...ip, prefix };
}

/** IPv4 映射的 IPv6（::ffff:a.b.c.d）还原成 IPv4，其余原样 */
export function unmapIpv4(ip: ParsedIp): ParsedIp {
  if (ip.version !== 6 || !MAPPED_PREFIX.every((value, index) => ip.bytes[index] === value)) return ip;
  return { version: 4, bytes: ip.bytes.slice(MAPPED_PREFIX.length) };
}

export function cidrContains(cidr: ParsedCidr, ip: ParsedIp): boolean {
  if (cidr.version !== ip.version) return false;
  const fullBytes = Math.floor(cidr.prefix / BITS_PER_BYTE);
  for (let index = 0; index < fullBytes; index += 1) {
    if (cidr.bytes[index] !== ip.bytes[index]) return false;
  }
  const restBits = cidr.prefix % BITS_PER_BYTE;
  if (restBits === 0) return true;
  const mask = (BYTE_MAX << (BITS_PER_BYTE - restBits)) & BYTE_MAX;
  return ((cidr.bytes[fullBytes] ?? 0) & mask) === ((ip.bytes[fullBytes] ?? 0) & mask);
}
