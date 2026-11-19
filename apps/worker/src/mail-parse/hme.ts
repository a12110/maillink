// iCloud 隐私邮箱（Hide My Email）转发头：X-ICLOUD-HME。
//   p=alias@icloud.com; d=example.net; f=mailbox@example.com; r=to; s=sender@example.net
// p 是别名，f 是转发目标，s 是原始发件人。格式依据参考项目 recipient_policy.ts 的注释，
// 尚未用真实 Apple 转发邮件核对（01 §4.1 的待办）。

const HME_HEADER_KEY = "x-icloud-hme";
const SIMPLE_ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+$/;
const ANGLE_ADDRESS = /<([^<>\s]+@[^<>\s]+)>/;

/** 头部字段拆成 key→value，key 小写；同名字段取第一个 */
export function parseHmeFields(value: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const segment of value.split(";")) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    const key = segment.slice(0, separator).trim().toLowerCase();
    if (key in fields) continue;
    fields[key] = segment.slice(separator + 1).trim();
  }
  return fields;
}

/** 从字段值里取出一个地址（全小写）。支持 `Name <a@b>`、纯地址与 %40 转义；取不到返回 null */
export function firstAddress(value: string | undefined): string | null {
  if (!value) return null;
  // 头里的值可能带引号：s="x@y"
  let text = value.trim().replace(/^["']+|["']+$/g, "");
  if (!text.includes("@") && /%40/i.test(text)) {
    try {
      text = decodeURIComponent(text);
    } catch {
      return null;
    }
  }
  const candidate = ANGLE_ADDRESS.exec(text)?.[1] ?? text;
  return SIMPLE_ADDRESS.test(candidate) ? candidate.toLowerCase() : null;
}

/**
 * HME 头里的原始发件人（s=）。仅当 p= 等于本邮件收件地址（不区分大小写）时采用：
 * 否则这个头可能来自别的别名或被伪造，其 s= 不能算本邮件的发件人。
 */
export function hmeSender(headers: ReadonlyArray<{ key: string; value: string }>, recipient: string): string | null {
  const header = headers.find((item) => item.key === HME_HEADER_KEY);
  if (!header) return null;
  const fields = parseHmeFields(header.value);
  const alias = firstAddress(fields["p"]);
  if (!alias || alias !== recipient.trim().toLowerCase()) return null;
  return firstAddress(fields["s"]);
}
