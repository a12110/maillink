// 所有上限与默认值集中在这里，禁止在业务代码里散落 magic number。
// 来源：docs/design/01-architecture-and-data.md §6。

// 前后端共用的输入规则定义在 packages/shared，这里重新导出，业务代码统一从 constants 取
export {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  LIST_PAGE_SIZE_MAX,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from "@maillink/shared";

const SECONDS_PER_DAY = 24 * 60 * 60;

/** 列表每页条数 */
export const LIST_PAGE_SIZE = 20;

/** 单次请求最多扫描的候选行数 */
export const SCAN_CAP_PER_REQUEST = 200;

/** 单次请求最多现场解析的邮件数（有界工作量，超出时响应带 partial: true） */
export const MAX_PARSE_PER_REQUEST = 10;

/** 一次从 MAIL_DB 取几封正文（raw 可能接近 2 MB，需要分批） */
export const RAW_FETCH_CHUNK = 5;

/** mail_index.body_text 的字节上限（32 KB） */
export const BODY_INDEX_CAP_BYTES = 32768;

/** 单个取件链接可绑定的收件地址上限 */
export const MAX_MAILBOXES_PER_LINK = 50;

/** 取件链接 token 的随机字节数，编码为 base64url */
export const LINK_TOKEN_BYTES = 32;

/** 取件页轮询的最小间隔（秒） */
export const LINK_POLL_MIN_SEC = 10;

/** 会话空闲过期（秒）：7 天，可被系统设置覆盖 */
export const SESSION_IDLE_SEC = 7 * SECONDS_PER_DAY;

/** 会话绝对过期（秒）：30 天，可被系统设置覆盖 */
export const SESSION_ABSOLUTE_SEC = 30 * SECONDS_PER_DAY;

/** 二次验证（MFA）待完成状态的有效期（秒） */
export const PENDING_MFA_SEC = 300;

/** OAuth state 的有效期（秒） */
export const OAUTH_STATE_SEC = 600;

// ---- 会话 ----

export const SESSION_COOKIE_NAME = "sid";

/** 会话 Cookie 值的随机字节数（base64url 编码后写入 Cookie，库里只存 SHA-256） */
export const SESSION_ID_BYTES = 32;

/** last_seen_at 的写入节流（秒）：距上次写入不足这个值就不再写库，避免每个请求一次写 */
export const SESSION_TOUCH_INTERVAL_SEC = 300;

/** 会话对外短 id 的字节数（HMAC-SHA256 截断），见 auth/session-public-id.ts */
export const SESSION_PUBLIC_ID_BYTES = 16;

/** 路径里会话短 id 参数的长度上限（实际是 22 个字符，留余量只为拒绝超长输入） */
export const PUBLIC_SESSION_ID_MAX_LENGTH = 64;

/** 会话记录里 user_agent 的最大长度，防止被超长请求头撑大库 */
export const SESSION_USER_AGENT_MAX_LENGTH = 255;

// ---- 密钥与密码 ----

export const BITS_PER_BYTE = 8;

/** HKDF 派生密钥的默认长度（字节） */
export const DEFAULT_KEY_BYTES = 32;

/** `.dev.vars.example` 里占位值的前缀；以它开头的 APP_SECRET 说明忘了替换 */
export const APP_SECRET_PLACEHOLDER_PREFIX = "replace-with";

/** APP_SECRET 的最小长度（字符数）。过短或缺失时显式报错，不回退任何默认值 */
export const APP_SECRET_MIN_LENGTH = 32;

/**
 * PBKDF2-SHA256 迭代数。
 *
 * Cloudflare Workers 生产环境的上限是 100,000：超过会在 deriveBits 抛
 * `NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not supported`
 * （Cloudflare 社区与 workerd#1346 均有记录）。
 * 注意：本地 `wrangler dev` / vitest 的 workerd 不执行这个上限（实测 600,000 次也能通过），
 * 所以本地测试无法证明生产可用，见 test/pbkdf2-limit.test.ts。
 * 取允许的最大值；校验时按存储里的迭代数计算，日后升级只需改这里并在登录成功时重新哈希。
 */
export const PBKDF2_ITERATIONS = 100_000;

/** PBKDF2 派生输出长度（字节） */
export const PBKDF2_HASH_BYTES = 32;

/** 每用户随机盐长度（字节） */
export const PASSWORD_SALT_BYTES = 16;

/** 存储格式里的算法标识 */
export const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
