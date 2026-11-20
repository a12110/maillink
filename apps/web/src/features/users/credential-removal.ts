import type { CredentialRemovalResponse } from "@maillink/shared";

/** 管理员对某个用户的凭据清除操作（03 §6）：两步验证、通行密钥（单把 / 全部）、OAuth 绑定（单个 / 全部） */
export type Removal =
  | { kind: "totp" }
  | { kind: "passkey"; id?: number; name?: string }
  | { kind: "identity"; id?: number; name?: string };

export type RemovalApi = {
  clearUserTotp: (userId: number) => Promise<CredentialRemovalResponse>;
  clearUserPasskeys: (userId: number, passkeyId?: number) => Promise<CredentialRemovalResponse>;
  clearUserIdentities: (userId: number, identityId?: number) => Promise<CredentialRemovalResponse>;
};

export function runRemoval(api: RemovalApi, userId: number, removal: Removal): Promise<CredentialRemovalResponse> {
  switch (removal.kind) {
    case "totp":
      return api.clearUserTotp(userId);
    case "passkey":
      return api.clearUserPasskeys(userId, removal.id);
    case "identity":
      return api.clearUserIdentities(userId, removal.id);
  }
}

const SESSIONS_NOTE = "该用户的全部会话会随之失效，需要重新登录。";

function targetOf(removal: Removal): string {
  switch (removal.kind) {
    case "totp":
      return "两步验证";
    case "passkey":
      return removal.id === undefined ? "全部通行密钥" : `通行密钥“${removal.name ?? removal.id}”`;
    case "identity":
      return removal.id === undefined ? "全部第三方账号绑定" : `第三方账号绑定“${removal.name ?? removal.id}”`;
  }
}

function effectOf(removal: Removal): string {
  switch (removal.kind) {
    case "totp":
      return "会删除 TA 的两步验证密钥与全部恢复码，之后只凭密码登录。";
    case "passkey":
      return "删除后不能再用被删的通行密钥登录。";
    case "identity":
      return "解除后不能再用被解除的第三方账号登录。";
  }
}

export type RemovalCopy = { title: string; consequence: string; confirmLabel: string };

/** 二次确认文案：写明对象、直接后果、会话失效；清自己的凭据时说明当前会话保留 */
export function describeRemoval(removal: Removal, username: string, isSelf: boolean): RemovalCopy {
  const target = targetOf(removal);
  const sessions = isSelf ? "这是你自己的账号：当前会话保留，其他会话会失效。" : SESSIONS_NOTE;
  return {
    title: `清除 ${username} 的${target}？`,
    consequence: `${effectOf(removal)}${sessions}管理员操作不会检查是否还剩其他登录方式。`,
    confirmLabel: removal.kind === "totp" ? "清除两步验证" : removal.id === undefined ? "全部清除" : "确认清除",
  };
}

export const NO_LOGIN_METHOD_MESSAGE = "该用户已没有可用的登录方式，请为其设置密码";
