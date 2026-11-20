import type { TotpSetupResponse } from "@maillink/shared";

/**
 * 两步验证的本地流程状态（纯函数，便于测试）：
 *   idle → setup（密钥与二维码）→ codes（一次性展示恢复码）→ idle
 * 重新生成恢复码是 idle → codes。恢复码只存在于 `codes` 阶段的内存里：用户确认后立即丢弃，
 * 后端也不会再返回明文，所以这里不做任何持久化（不写 localStorage / 缓存）。
 */
export type TotpFlow =
  | { phase: "idle" }
  | { phase: "setup"; secret: string; otpauthUri: string; expiresAt: number }
  | { phase: "codes"; codes: readonly string[]; origin: "enable" | "regenerate" };

export type TotpFlowEvent =
  | { type: "setup_started"; setup: TotpSetupResponse }
  | { type: "setup_cancelled" }
  | { type: "enabled"; codes: readonly string[] }
  | { type: "regenerated"; codes: readonly string[] }
  | { type: "codes_acknowledged" };

export const IDLE_TOTP_FLOW: TotpFlow = { phase: "idle" };

function when(state: TotpFlow, phase: TotpFlow["phase"], next: () => TotpFlow): TotpFlow {
  return state.phase === phase ? next() : state;
}

/** 不合法的转移（比如没有 setup 就“启用成功”）原样保持当前状态，不凭空生成恢复码阶段 */
export function totpFlowReducer(state: TotpFlow, event: TotpFlowEvent): TotpFlow {
  switch (event.type) {
    case "setup_started":
      return when(state, "idle", () => ({
        phase: "setup",
        secret: event.setup.secret,
        otpauthUri: event.setup.otpauth_uri,
        expiresAt: event.setup.expires_at,
      }));
    case "setup_cancelled":
      return when(state, "setup", () => IDLE_TOTP_FLOW);
    case "enabled":
      return when(state, "setup", () => ({ phase: "codes", codes: event.codes, origin: "enable" }));
    case "regenerated":
      return when(state, "idle", () => ({ phase: "codes", codes: event.codes, origin: "regenerate" }));
    case "codes_acknowledged":
      return when(state, "codes", () => IDLE_TOTP_FLOW);
  }
}

/** 恢复码下载文件的内容：本地生成的纯文本，不经过任何网络 */
export function buildRecoveryCodesFile(input: { siteName: string; username: string; codes: readonly string[]; now: Date }): string {
  return [
    `${input.siteName} 恢复码`,
    `账号：${input.username}`,
    `生成时间：${input.now.toISOString()}`,
    "",
    "每个恢复码只能使用一次。丢失验证器时可用它登录；请离线保管，不要和密码放在一起。",
    "",
    ...input.codes,
    "",
  ].join("\n");
}

export const RECOVERY_CODES_FILENAME = "maillink-recovery-codes.txt";
