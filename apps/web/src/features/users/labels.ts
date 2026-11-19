import { userRoleSchema, userStatusSchema } from "@maillink/shared";
import type { AdminUser, UserRole, UserStatus } from "@maillink/shared";

export const ROLE_LABEL: Record<UserRole, string> = { admin: "管理员", user: "普通用户" };
export const STATUS_LABEL: Record<UserStatus, string> = { active: "启用", disabled: "已停用" };

export const ROLE_OPTIONS = [
  { value: "user", label: ROLE_LABEL.user },
  { value: "admin", label: ROLE_LABEL.admin },
] as const satisfies ReadonlyArray<{ value: UserRole; label: string }>;

export const STATUS_OPTIONS = [
  { value: "active", label: STATUS_LABEL.active },
  { value: "disabled", label: STATUS_LABEL.disabled },
] as const satisfies ReadonlyArray<{ value: UserStatus; label: string }>;

/** 列表里“登录方式”列的标记（03 §6）：密码 / 2FA / 通行密钥数 / 已绑定的提供方 */
export function loginMethodLabels(methods: AdminUser["login_methods"]): string[] {
  const labels: string[] = [];
  if (methods.password) labels.push("密码");
  if (methods.totp) labels.push("2FA");
  if (methods.passkey_count > 0) labels.push(`通行密钥 ×${methods.passkey_count}`);
  labels.push(...methods.oauth_providers);
  return labels;
}

/** 筛选下拉的值：空串 = 不筛选，其余必须是合法枚举 */
export function toRoleFilter(value: string): UserRole | "" {
  return value === "" ? "" : userRoleSchema.parse(value);
}

export function toStatusFilter(value: string): UserStatus | "" {
  return value === "" ? "" : userStatusSchema.parse(value);
}
