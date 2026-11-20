import type { AuthContext } from "./auth/context";

/** Worker 的绑定与环境变量，字段说明见 docs/design/01-architecture-and-data.md §2 */
export type Bindings = {
  /** 自有库，唯一允许迁移与写入的库 */
  APP_DB: D1Database;
  /** cloudflare_temp_email 的邮件库，只读，仅 src/mail-source/ 可以使用 */
  MAIL_DB: D1Database;
  /** 前端静态资源 */
  ASSETS: Fetcher;
  /** 登录与链接访问限流；未绑定时相关功能必须显式报"未配置" */
  RATE_LIMITER?: RateLimit;
  /** 取件链接访问限流，阈值独立于 RATE_LIMITER；未绑定时取件链接接口显式报"未配置" */
  LINK_RATE_LIMITER?: RateLimit;
  /** WebAuthn RP ID、OAuth 回调地址、Cookie 域的唯一来源 */
  PUBLIC_ORIGIN: string;
  /** 主密钥（secret），本地放 .dev.vars */
  APP_SECRET?: string;
  /** 首次初始化令牌（secret），用完可删 */
  SETUP_TOKEN?: string;
};

/** requireUser / requireAdmin 通过后才会设置 `auth` */
export type Variables = { auth: AuthContext };

export type AppEnv = { Bindings: Bindings; Variables: Variables };
