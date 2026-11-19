import { ADDRESS_MASK, ADDRESS_MASK_KEEP_CHARS } from "@maillink/shared";

/**
 * 收件地址打码（02 §4.2）：本地部分保留前 min(2, ⌊长度/2⌋) 个字符，其余换成固定的 `***`，域名保留。
 * 固定长度的掩码不泄露原长度；"不超过一半"保证短地址也至少藏住一半：
 *   a@x → ***@x，ab@x → a***@x，abc@x → a***@x，abcd@x → ab***@x，abcdefgh@x → ab***@x。
 * 按 Unicode 码点计数；没有 @ 的输入整体换成 `***`。
 */
export function maskAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 0) return ADDRESS_MASK;
  const local = [...address.slice(0, at)];
  const keep = Math.min(ADDRESS_MASK_KEEP_CHARS, Math.floor(local.length / 2));
  return `${local.slice(0, keep).join("")}${ADDRESS_MASK}@${address.slice(at + 1)}`;
}
