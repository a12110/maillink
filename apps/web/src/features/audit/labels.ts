// 审计动作（apps/worker/src/audit.ts 的 AUDIT_ACTIONS）→ 中文。未登记的动作原样显示，不吞。

export const AUDIT_ACTION_LABEL: Readonly<Record<string, string>> = {
  "setup.complete": "完成初始化",
  "auth.login": "登录成功",
  "auth.login_failed": "登录失败",
  "auth.password_change": "修改密码",
  "auth.session_revoke": "注销会话",
  "auth.sessions_revoke_others": "注销其他会话",
  "auth.mfa_failed": "两步验证失败",
  "auth.mfa_locked": "两步验证被锁定",
  "auth.reauth_failed": "再确认失败",
  "auth.totp_enable": "启用两步验证",
  "auth.totp_disable": "关闭两步验证",
  "auth.recovery_codes_regenerate": "重新生成恢复码",
  "auth.passkey_add": "添加通行密钥",
  "auth.passkey_rename": "重命名通行密钥",
  "auth.passkey_remove": "删除通行密钥",
  "auth.passkey_counter_rollback": "通行密钥计数回退",
  "auth.identity_link": "关联外部身份",
  "auth.identity_link_rejected": "拒绝关联外部身份",
  "auth.identity_unlink": "解除外部身份",
  "auth.oauth_signup": "OAuth 注册",
  "user.create": "创建用户",
  "user.update": "修改用户",
  "user.delete": "删除用户",
  "user.password_reset": "重置用户密码",
  "user.sessions_revoke": "注销用户全部会话",
  "user.totp_clear": "清除用户两步验证",
  "user.passkeys_remove": "清除用户通行密钥",
  "user.identities_remove": "清除用户外部身份",
  "oauth_provider.create": "添加 OAuth 提供方",
  "oauth_provider.update": "修改 OAuth 提供方",
  "oauth_provider.delete": "删除 OAuth 提供方",
  "oauth_provider.update_rejected": "拒绝修改 OAuth 提供方",
  "rule_group.create": "创建规则组",
  "rule_group.update": "修改规则组",
  "rule_group.delete": "删除规则组",
  "mailbox.import": "导入收件地址",
  "mailbox.update": "修改收件地址",
  "mailbox.delete": "删除收件地址",
  "mailbox.batch": "批量操作收件地址",
};

export const AUDIT_TARGET_LABEL: Readonly<Record<string, string>> = {
  user: "用户",
  session: "会话",
  passkey: "通行密钥",
  identity: "外部身份",
  oauth_provider: "OAuth 提供方",
  rule_group: "规则组",
  mailbox: "收件地址",
};

export function actionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? action;
}

export function targetLabel(type: string | null, id: string | null): string | null {
  if (type === null) return null;
  const name = AUDIT_TARGET_LABEL[type] ?? type;
  return id === null ? name : `${name} #${id}`;
}
