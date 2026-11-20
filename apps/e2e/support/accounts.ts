import { resolve } from "node:path";

/** 测试账号。密码只在每次运行新建的临时数据里有效 */
export const ADMIN = { username: "e2e-admin", password: "e2e-admin-password-1" } as const;

/** 初始化用例登录后保存的管理员会话（Cookie），其余用例用 `test.use({ storageState: ADMIN_STATE })` 复用，免得反复登录触发限流 */
export const ADMIN_STATE = resolve(import.meta.dirname, "..", ".auth", "admin.json");

/** 06 里普通用户登录后保存的会话；08、11 复用它，少登录几次（登录接口每 IP 每分钟 10 次） */
export const VIEWER_STATE = resolve(import.meta.dirname, "..", ".auth", "viewer.json");

export type Account = { username: string; password: string };

/** 授权、两步验证、通行密钥等用例各用自己的普通用户，互不影响 */
export function userAccount(name: string): Account {
  return { username: `e2e-${name}`, password: `e2e-${name}-password-1` };
}
