import type { SessionUser } from "@maillink/shared";

/** 鉴权中间件通过后挂在 `c.var.auth` 上的当前身份 */
export type AuthContext = {
  user: SessionUser & { status: "active" };
  session: {
    /** sha256(Cookie 值)，库里的主键；不要对外暴露 */
    idHash: string;
    authMethods: string[];
    /** 会话创建时间（Unix 秒），用于"刚登录过"的判断 */
    createdAt: number;
    expiresAt: number;
  };
};
