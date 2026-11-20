import { resolve } from "node:path";

/** 测试账号。密码只在每次运行新建的临时数据里有效 */
export const ADMIN = { username: "e2e-admin", password: "e2e-admin-password-1" } as const;

/** 初始化用例登录后保存的管理员会话（Cookie），其余用例用 `test.use({ storageState: ADMIN_STATE })` 复用，免得反复登录触发限流 */
export const ADMIN_STATE = resolve(import.meta.dirname, "..", ".auth", "admin.json");

export type Account = { username: string; password: string };

/** 授权、两步验证、通行密钥等用例各用自己的普通用户，互不影响 */
export function userAccount(name: string): Account {
  return { username: `e2e-${name}`, password: `e2e-${name}-password-1` };
}
