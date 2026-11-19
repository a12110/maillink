import { uniqueViolationTarget } from "../db/errors";
import { ApiError } from "../errors";
import { HTTP_CONFLICT } from "../http-status";

const CONFLICTS: Record<string, { code: string; message: string }> = {
  "users.username_lc": { code: "username_taken", message: "用户名已被使用" },
  "users.email_lc": { code: "email_taken", message: "邮箱已被其他用户使用" },
};

/** 把 users 表的唯一约束冲突转成 409；其他错误原样抛出 */
export async function mapUserConflicts<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    const target = uniqueViolationTarget(error);
    const conflict = target === null ? undefined : CONFLICTS[target];
    if (conflict) throw new ApiError(HTTP_CONFLICT, conflict.code, conflict.message);
    throw error;
  }
}
