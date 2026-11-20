import type { TurnstileScope, TurnstileSettings } from "@maillink/shared";
import { KEY_PURPOSES } from "../auth/keys";
import { openText, sealText } from "../auth/secret-box";
import { getSettings } from "../db/settings";
import type { Bindings } from "../env";

// Turnstile 配置的读取与 secret 加解密。secret 用 APP_SECRET 派生的专用密钥 AES-GCM 加密后存 settings，
// 读取接口只回"已设置"，只有校验时才解密。

const SECRET_AAD = "turnstile-secret";

type SecretEnv = Pick<Bindings, "APP_SECRET">;

export function sealTurnstileSecret(env: SecretEnv, secret: string): Promise<string> {
  return sealText(env, KEY_PURPOSES.turnstileSecret, SECRET_AAD, secret);
}

/** 解密失败说明数据损坏或 APP_SECRET 被换过，直接抛出（不当作"未配置"悄悄放行） */
export function openTurnstileSecret(env: SecretEnv, sealed: string): Promise<string> {
  return openText(env, KEY_PURPOSES.turnstileSecret, SECRET_AAD, sealed);
}

export type TurnstileConfig = {
  enabled: boolean;
  siteKey: string;
  scopes: TurnstileScope[];
  /** 密文；空串 = 未设置 */
  secretEnc: string;
};

export async function loadTurnstileConfig(db: D1Database): Promise<TurnstileConfig> {
  const stored = await getSettings(db, ["turnstile.enabled", "turnstile.site_key", "turnstile.scopes", "turnstile.secret_enc"]);
  return {
    enabled: stored["turnstile.enabled"],
    siteKey: stored["turnstile.site_key"],
    scopes: stored["turnstile.scopes"],
    secretEnc: stored["turnstile.secret_enc"],
  };
}

export function toTurnstileSettings(config: TurnstileConfig): TurnstileSettings {
  return { enabled: config.enabled, site_key: config.siteKey, secret_set: config.secretEnc !== "", scopes: config.scopes };
}
