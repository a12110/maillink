// 认证相关的底层密码学小工具：只做编码、随机数、摘要与常量时间比较，不含业务逻辑。

const encoder = new TextEncoder();

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function bytesToBinary(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return binary;
}

export function toBase64(bytes: Uint8Array): string {
  return btoa(bytesToBinary(bytes));
}

/** 输入不是合法 base64 时抛 Error（不吞） */
export function fromBase64(text: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw new Error("无效的 base64 字符串");
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(input: string | Uint8Array): Promise<Uint8Array> {
  const data = typeof input === "string" ? utf8(input) : input;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await sha256(input));
}

/** 常量时间比较。长度不同直接返回 false（本系统比较的都是定长摘要，长度不是秘密） */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

/** 常量时间比较任意长度字符串：先各自取 SHA-256 再比，避免泄露长度与前缀信息 */
export async function timingSafeEqualStrings(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([sha256(a), sha256(b)]);
  return timingSafeEqualBytes(hashA, hashB);
}
