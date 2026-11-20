import type { Context } from "hono";
import { clientIp } from "./auth/session";
import { nowSec } from "./clock";
import { insertAuditLog } from "./db/audit";
import type { AppEnv } from "./env";

/** 审计动作名。03 §8；本里程碑只含认证与用户管理，其余里程碑在这里追加 */
export const AUDIT_ACTIONS = {
  setupComplete: "setup.complete",
  loginSuccess: "auth.login",
  loginFailed: "auth.login_failed",
  passwordChange: "auth.password_change",
  userCreate: "user.create",
  userUpdate: "user.update",
  userDelete: "user.delete",
  userPasswordReset: "user.password_reset",
  userSessionsRevoke: "user.sessions_revoke",
  sessionRevoke: "auth.session_revoke",
  // M3b：规则组与收件地址
  ruleGroupCreate: "rule_group.create",
  ruleGroupUpdate: "rule_group.update",
  ruleGroupDelete: "rule_group.delete",
  mailboxImport: "mailbox.import",
  mailboxUpdate: "mailbox.update",
  mailboxDelete: "mailbox.delete",
  mailboxBatch: "mailbox.batch",
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditInput = {
  action: AuditAction;
  /** 执行者；登录失败等没有已确认身份的场景为 null */
  actorUserId: number | null;
  targetType?: "user" | "session" | "rule_group" | "mailbox";
  targetId?: number | string;
  /** 会被 JSON 序列化。禁止放密码、令牌、哈希 */
  detail?: Record<string, unknown>;
};

/**
 * 写一条审计日志。写失败会直接抛出（不吞）：审计缺失比请求失败更糟，
 * 代价是业务动作已执行但响应变成 500，调用方在动作之后立即记录以缩小这个窗口。
 */
export async function recordAudit(c: Context<AppEnv>, input: AuditInput): Promise<void> {
  await insertAuditLog(c.env.APP_DB, {
    actor_user_id: input.actorUserId,
    action: input.action,
    target_type: input.targetType ?? null,
    target_id: input.targetId === undefined ? null : String(input.targetId),
    detail: input.detail ? JSON.stringify(input.detail) : null,
    ip: clientIp(c),
    created_at: nowSec(),
  });
}
