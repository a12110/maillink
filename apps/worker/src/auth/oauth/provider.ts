import { claimMapSchema } from "@maillink/shared";
import type { ClaimMap } from "@maillink/shared";
import type { OAuthProviderRow } from "../../db/oauth-providers";
import type { Bindings } from "../../env";
import { KEY_PURPOSES } from "../keys";
import { openText, sealText } from "../secret-box";

// 提供方配置的读取辅助：client_secret 加解密、claim_map 解析、固定回调地址。

const SECRET_AAD = "oauth-client-secret";

export function sealClientSecret(env: Pick<Bindings, "APP_SECRET">, secret: string): Promise<string> {
  return sealText(env, KEY_PURPOSES.oauthClientSecret, SECRET_AAD, secret);
}

/** 解密失败说明数据损坏或 APP_SECRET 被换过，直接抛出 */
export function openClientSecret(env: Pick<Bindings, "APP_SECRET">, row: Pick<OAuthProviderRow, "client_secret_enc">): Promise<string> {
  return openText(env, KEY_PURPOSES.oauthClientSecret, SECRET_AAD, row.client_secret_enc);
}

/** 库里的 claim_map 不合 schema 属于数据损坏，抛错而不是换成默认值 */
export function parseClaimMap(row: Pick<OAuthProviderRow, "claim_map">): ClaimMap {
  return claimMapSchema.parse(JSON.parse(row.claim_map));
}

/** 回调地址固定为 `${PUBLIC_ORIGIN}/api/auth/oauth/<slug>/callback`（03 §4.4） */
export function callbackUrl(env: Pick<Bindings, "PUBLIC_ORIGIN">, slug: string): string {
  return `${new URL(env.PUBLIC_ORIGIN).origin}/api/auth/oauth/${slug}/callback`;
}
