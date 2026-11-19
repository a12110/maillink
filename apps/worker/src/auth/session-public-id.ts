import { SESSION_PUBLIC_ID_BYTES } from "../constants";
import type { Bindings } from "../env";
import { toBase64Url, utf8 } from "./crypto";
import { KEY_PURPOSES, deriveKey } from "./keys";

/**
 * 会话对外的短 id = base64url(HMAC-SHA256(子密钥, id_hash) 的前 16 字节)。
 *
 * 为什么不直接暴露 id_hash：
 * - id_hash 是库的主键，也是 Cookie 值的"查找凭据"；它不该出现在任何 API 响应、日志或前端状态里。
 * - 加了 APP_SECRET 派生的密钥后，短 id 无法由库内容单独算出，也无法反推 id_hash，
 *   泄露短 id（截图、前端报错上报）既不能冒用会话，也不能定位库里的行。
 * - 短 id 只在"同一用户的会话列表"范围内解析（见 routes/me.ts），不是全局可查的凭据。
 */
export async function createSessionPublicIdMaker(
  env: Pick<Bindings, "APP_SECRET">,
): Promise<(idHash: string) => Promise<string>> {
  const raw = await deriveKey(env, KEY_PURPOSES.sessionPublicId);
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return async (idHash) => {
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(idHash)));
    return toBase64Url(mac.slice(0, SESSION_PUBLIC_ID_BYTES));
  };
}
