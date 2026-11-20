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

/** GET /api/admin/mailboxes/tags 一次最多返回的标签种类（按使用次数降序取前面的） */
export const MAILBOX_TAG_LIST_MAX = 500;

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

// ---- 邮件解析与索引（M2） ----

/**
 * 解析器版本。解析逻辑、词表（验证码关键词、分类关键词）任何改动都要递增：
 * mail_index 里版本不符的行会在下次访问时重建（01 §4.2）。
 */
export const PARSER_VERSION = 4;

/** 每封邮件最多保留的链接数，超出的丢弃（正文里的原文仍在 body 中，body 类规则照常命中） */
export const MAIL_LINKS_MAX_COUNT = 50;

/** 单个链接的字符上限，超出的丢弃 */
export const MAIL_LINK_MAX_LENGTH = 2048;

/** 验证码长度范围（去掉分隔符之后） */
export const CODE_MIN_LENGTH = 4;
export const CODE_MAX_LENGTH = 8;

/** 验证码候选与关键词之间允许的最大间隔（字符数）。更远的数字不算"紧邻" */
export const CODE_KEYWORD_GAP_MAX = 24;

/** temp_email 的 ai_extract 结果长度上限；超出视为无效，回退到内置提取 */
export const AI_CODE_MAX_LENGTH = 32;

/** mail_index.parse_error 的长度上限 */
export const PARSE_ERROR_MAX_LENGTH = 500;

/** postal-mime 的解析保护：MIME 嵌套深度与分块数量（库默认值过大） */
export const MAIL_PARSE_MAX_NESTING_DEPTH = 32;
export const MAIL_PARSE_MAX_PART_COUNT = 500;

/** 管理员详情接口返回正文的字节上限（索引里的 32 KB 副本只用于规则判定） */
export const ADMIN_DETAIL_BODY_CAP_BYTES = 262_144;

/**
 * "已导入地址 / 未知地址"范围一次最多传给 MAIL_DB 的地址数。
 * 地址以 JSON 数组（每个地址两种大小写形式）作为单个绑定参数传入，受 D1 单个字符串 2 MB 上限约束；
 * 1 万个地址约 0.8 MB，留足余量。超出时明确报错，不静默截断。
 */
export const IMPORTED_SCOPE_MAX_ADDRESSES = 10_000;

// ---- 用户授权与收件箱（M4） ----

// 批量授权的上限（定义在 shared，zod schema 要用），业务代码统一从这里取
export {
  GRANT_BATCH_MAX_MAILBOXES,
  GRANT_BATCH_MAX_PAIRS,
  GRANT_BATCH_MAX_USERS,
} from "@maillink/shared";

/**
 * "全部"邮件一次最多合并的作用域数（同规则组、同时间下界的授权合成一个；设了 max_mails 的授权各占一个）。
 * 作用域顺序扫描，共用一份解析预算，所以一次请求的工作量上界是：
 *   - 现场解析 ≤ MAX_PARSE_PER_REQUEST 封（与单个作用域相同，不随作用域数放大）；
 *   - 扫描候选行 ≤ ME_ALL_MAX_SCOPES × SCAN_CAP_PER_REQUEST（最坏情况：每个作用域都扫满上限仍凑不够一页）。
 * 超出作用域数时明确拒绝，让用户改选具体邮箱，不静默截断。
 */
export const ME_ALL_MAX_SCOPES = 20;
// ---- 取件链接（M3b-2） ----

/** token_hint 的长度（token 前几位，列表里辨认用） */
export const LINK_TOKEN_HINT_LENGTH = 6;

/** token_enc 的 AES-GCM IV 长度（字节） */
export const LINK_TOKEN_IV_BYTES = 12;

/** 公开取件页路径前缀：完整链接 = PUBLIC_ORIGIN + 前缀 + token */
export const LINK_PUBLIC_PATH_PREFIX = "/s/";

/** 访客 Cookie：名字 = 前缀 + 链接 id；值是随机串，库里只存 SHA-256 */
export const LINK_VISITOR_COOKIE_PREFIX = "mlv_";
export const LINK_VISITOR_COOKIE_PATH = "/api/s/";
export const LINK_VISITOR_ID_BYTES = 32;

/** 链接没有任何过期时间时访客 Cookie 的有效期：180 天（有过期时间时取剩余有效期，两者取小） */
export const LINK_VISITOR_COOKIE_MAX_SEC = 180 * SECONDS_PER_DAY;

/** 每日取码上限的滚动窗口（02 §6：滚动 24 小时） */
export const LINK_DELIVERY_WINDOW_SEC = SECONDS_PER_DAY;

/** 访问口令错误次数上限：同一链接 + 同一 IP 在窗口内错满即锁定到窗口滚过 */
export const LINK_PASSWORD_MAX_FAILURES = 5;
export const LINK_PASSWORD_FAILURE_WINDOW_SEC = 15 * 60;

/** 按链接的全局上限：同一链接在窗口内累计这么多次口令错误后，对所有新设备锁定（已登记设备 start 时不再要口令） */
export const LINK_PASSWORD_MAX_FAILURES_PER_LINK = 20;

/**
 * 同时进行中的口令校验（link_password_inflight）上限：链接 + IP 桶与失败上限相同，链接全局与按链接的失败上限相同。
 * 进行中的不计入失败，所以暴力猜测在锁定前最多试"失败上限 + 进行中上限"次（链接 + IP 桶 5 + 5，链接全局 20 + 20）。
 * 超出时 429 link_password_busy，不锁定、不计失败。
 */
export const LINK_PASSWORD_MAX_INFLIGHT = LINK_PASSWORD_MAX_FAILURES;
export const LINK_PASSWORD_MAX_INFLIGHT_PER_LINK = LINK_PASSWORD_MAX_FAILURES_PER_LINK;

/** link_password_busy 的 Retry-After（秒） */
export const LINK_PASSWORD_BUSY_RETRY_SEC = 1;

/**
 * 进行中占位的过期兜底（秒）：正常在 PBKDF2 结束时删除；Worker 被中断没删掉的，过期后不再计数。
 * 一次 PBKDF2（PBKDF2_ITERATIONS 次迭代）在 Workers 上是百毫秒级，加上前后几次 D1 往返也远小于这个值。
 */
export const LINK_PASSWORD_INFLIGHT_TTL_SEC = 10;

/** 口令错误按 IP 计数时 IPv6 合并到的网段字节数：8 字节 = /64（一个用户通常拿到整个 /64） */
export const LINK_PASSWORD_IPV6_BUCKET_BYTES = 8;

/** 拿不到来源 IP 时共用的计数桶 */
export const LINK_PASSWORD_UNKNOWN_IP_BUCKET = "unknown";

/** 访客 Cookie 名里 HMAC(链接 id) 的 base64url 字符数（16 字符 = 96 位，不可枚举、不暴露自增 id） */
export const LINK_VISITOR_COOKIE_NAME_CHARS = 16;

/** 批量创建链接时单个 JSON 参数的字节上限（D1 单个值上限 2 MB，留一半余量）；超出说明调用方没控制好批量大小，直接报错 */
export const LINK_INSERT_PAYLOAD_MAX_BYTES = 1_000_000;

/**
 * 链接列表的异常标记（06 §7"设备数、国家数异常的行做标记"）：
 *   - device_limit_reached：设了 max_devices 且已登记设备数达到上限；
 *   - multi_country：已登记设备来自的不同国家数 ≥ 这个阈值。
 */
export const LINK_ANOMALY_COUNTRY_THRESHOLD = 2;

/** 访问日志与设备记录里 user_agent 的最大长度 */
export const LINK_USER_AGENT_MAX_LENGTH = 255;

/** 管理员预览里 visitor_hash 显示的前几位 */
export const LINK_VISITOR_HINT_LENGTH = 8;

/**
 * API 取码整体占的那台设备在 link_visitors.visitor_hash 里的固定标识（服务端给，不依赖 Cookie）。
 * 浏览器访客是 64 位十六进制的 SHA-256，不会与它相同；管理员预览里显示为 "api"。
 */
export const LINK_API_VISITOR_HASH = "api";
// ---- 两步验证、通行密钥、OAuth（M5） ----

// 前后端共用的认证输入上限定义在 packages/shared/src/auth-limits.ts
export {
  OAUTH_CLIENT_ID_MAX_LENGTH,
  OAUTH_CLIENT_SECRET_MAX_LENGTH,
  OAUTH_ICON_MAX_LENGTH,
  OAUTH_NAME_MAX_LENGTH,
  OAUTH_SCOPES_MAX_LENGTH,
  OAUTH_SLUG_MAX_LENGTH,
  OAUTH_URL_MAX_LENGTH,
  PASSKEY_NAME_MAX_LENGTH,
  RECOVERY_CODE_INPUT_MAX_LENGTH,
  TOTP_DIGITS,
  WEBAUTHN_FIELD_MAX_LENGTH,
} from "@maillink/shared";

/** TOTP（RFC 6238）参数：SHA-1、30 秒一步，前后各容忍一步；位数 TOTP_DIGITS 见 shared */
export const TOTP_PERIOD_SEC = 30;
export const TOTP_WINDOW_STEPS = 1;
/** TOTP 密钥长度（字节）：160 位，RFC 4226 推荐值 */
export const TOTP_SECRET_BYTES = 20;
/** 启用 2FA 前暂存密钥的加密 Cookie 有效期（秒） */
export const TOTP_SETUP_SEC = 600;
/** otpauth URI 里发行方（取站点名称）的长度上限 */
export const TOTP_ISSUER_MAX_LENGTH = 64;

/** 恢复码数量与每个恢复码的字符数（不含分隔符；字母表 32 个字符，每字符 5 位熵） */
export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_LENGTH = 10;

/** 一个 pending_auth 最多提交几次二次验证（含成功的那次），超过即作废 */
export const PENDING_MFA_MAX_ATTEMPTS = 5;

/** 通行密钥 challenge 的签名 Cookie 有效期（秒），同时作为浏览器端 WebAuthn 超时 */
export const PASSKEY_CHALLENGE_SEC = 300;
export const MS_PER_SEC = 1000;
/** challenge 随机字节数 */
export const PASSKEY_CHALLENGE_BYTES = 32;
/** WebAuthn user handle 的字节数（HMAC 截断，规范上限 64） */
export const PASSKEY_USER_HANDLE_BYTES = 32;
/** 单个用户最多注册的通行密钥数 */
export const PASSKEY_MAX_PER_USER = 20;

/** OAuth state / nonce / PKCE code_verifier 的随机字节数（base64url 后 43 个字符） */
export const OAUTH_RANDOM_BYTES = 32;
/** 访问 IdP（发现文档、token、JWKS、userinfo）的超时与响应体上限 */
export const OAUTH_FETCH_TIMEOUT_MS = 5000;
export const OAUTH_FETCH_MAX_BYTES = 65_536;
/** id_token 时间类声明（exp / nbf / iat）允许的时钟偏差（秒） */
export const OAUTH_CLOCK_TOLERANCE_SEC = 60;
/** 从 IdP 取到的 subject / 显示名的长度上限 */
export const OAUTH_SUBJECT_MAX_LENGTH = 255;
/** OAuth 自动建号时用户名随机后缀的字节数（hex） */
export const OAUTH_USERNAME_SUFFIX_BYTES = 3;
/** OAuth 自动建号时用户名冲突的最大重试次数 */
export const OAUTH_USERNAME_MAX_TRIES = 5;

/** 按用户的第二因素失败上限：窗口内累计尝试达到次数即锁定（登录第二步与再确认共用），成功后清零 */
export const MFA_USER_FAILURE_MAX = 10;
export const MFA_USER_FAILURE_WINDOW_SEC = 900;
export const MFA_USER_LOCK_SEC = 900;

/** 没有密码的账号做敏感操作（启用 2FA、添加通行密钥）时，会话创建不超过这么久才视为"刚登录过" */
export const RECENT_AUTH_SEC = 600;
// ---- 限流（M7a，01 §2 RATE_LIMITER） ----

/**
 * Workers Rate Limiting 的阈值是"每个 binding 一组"：limit 与 period 写在 wrangler.jsonc 的
 * `ratelimits[].simple` 里，运行时 `limit({ key })` 只传 key。period 只能是 10 或 60 秒。
 * 下面的数值必须与 wrangler.jsonc 保持一致（用于 Retry-After 与一致性测试，代码里不再另设阈值）；
 * 各用途靠 key 前缀互相隔离，彼此的计数不混用。
 */
export const RATE_LIMIT_PERIOD_SEC = 60;
export const RATE_LIMIT_MAX_REQUESTS = 10;

/**
 * 取件链接单独一个 binding：访客页每 LINK_POLL_MIN_SEC（10 秒）轮询一次，即每个标签页约 6 次/分钟，
 * 再加开始取码、取码、下载；同一 NAT 下多个标签页或设备共用 `link:<token_hash>:<ip>` 一个桶，
 * 取 120 次/分钟既容得下正常使用，又足以拦住脚本。
 */
export const LINK_RATE_LIMIT_PERIOD_SEC = 60;
export const LINK_RATE_LIMIT_MAX_REQUESTS = 120;

/** 两个限流 binding 的阈值，键是 env 上的绑定名 */
export const RATE_LIMITER_SETTINGS = {
  RATE_LIMITER: { limit: RATE_LIMIT_MAX_REQUESTS, periodSec: RATE_LIMIT_PERIOD_SEC },
  LINK_RATE_LIMITER: { limit: LINK_RATE_LIMIT_MAX_REQUESTS, periodSec: LINK_RATE_LIMIT_PERIOD_SEC },
} as const;
export type RateLimiterBindingName = keyof typeof RATE_LIMITER_SETTINGS;

/** 限流 key 里单个片段（用户名、IP、token 哈希）的长度上限，防止超长输入撑大 key */
export const RATE_LIMIT_KEY_PART_MAX_LENGTH = 128;

/** 请求没有 CF-Connecting-IP（本地开发、测试）时统一归入的 IP 片段：共用一个桶，偏严而不是放行 */
export const RATE_LIMIT_NO_IP_PART = "no-ip";

/** 限流用途，同时也是 key 前缀：`<用途>:<片段>[:<片段>]`，如 `login:ip:203.0.113.7` */
export const RATE_LIMIT_PURPOSES = {
  loginIp: "login:ip",
  loginUser: "login:user",
  setupIp: "setup:ip",
  mfaIp: "mfa:ip",
  passkeyIp: "passkey:ip",
  oauthIp: "oauth:ip",
  /** 再确认类：改密码、2FA 管理、重新生成恢复码、发起 OAuth 绑定，都要求验证旧密码或一次性码，可被拿来猜 */
  reauthIp: "reauth:ip",
  /** 通行密钥管理（注册、改名、删除） */
  passkeyManageIp: "passkey-manage:ip",
  registerIp: "register:ip",
  /** 取件链接访问（M3b-2）：`link:<token_hash>:<ip>` */
  link: "link",
} as const;
export type RateLimitPurpose = (typeof RATE_LIMIT_PURPOSES)[keyof typeof RATE_LIMIT_PURPOSES];

/** 每个用途使用哪个 binding；Record 保证新增用途时必须在这里表态 */
export const RATE_LIMIT_BINDING_BY_PURPOSE: Record<RateLimitPurpose, RateLimiterBindingName> = {
  "login:ip": "RATE_LIMITER",
  "login:user": "RATE_LIMITER",
  "setup:ip": "RATE_LIMITER",
  "mfa:ip": "RATE_LIMITER",
  "passkey:ip": "RATE_LIMITER",
  "oauth:ip": "RATE_LIMITER",
  "reauth:ip": "RATE_LIMITER",
  "passkey-manage:ip": "RATE_LIMITER",
  "register:ip": "RATE_LIMITER",
  link: "LINK_RATE_LIMITER",
};

type RateLimitedMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/**
 * 受限流保护的路由清单：index.ts 遍历它挂载中间件，测试读同一份并检查 app.routes 没有漏网的写接口。
 * 新增认证类或再确认类写接口时，必须加进来。
 * `usernameKeyed`：请求体里有用户名，除 IP 外再按用户名限流（只有登录）。
 * 路径按 Hono 语法，`/*` 同时匹配前缀本身与其下所有子路径。
 */
export const RATE_LIMITED_ROUTES: ReadonlyArray<{
  method: RateLimitedMethod;
  path: string;
  purpose: RateLimitPurpose;
  usernameKeyed?: true;
}> = [
  { method: "POST", path: "/api/auth/login", purpose: RATE_LIMIT_PURPOSES.loginIp, usernameKeyed: true },
  { method: "POST", path: "/api/auth/register", purpose: RATE_LIMIT_PURPOSES.registerIp },
  { method: "POST", path: "/api/setup", purpose: RATE_LIMIT_PURPOSES.setupIp },
  { method: "POST", path: "/api/auth/mfa/*", purpose: RATE_LIMIT_PURPOSES.mfaIp },
  { method: "POST", path: "/api/auth/passkey/*", purpose: RATE_LIMIT_PURPOSES.passkeyIp },
  { method: "GET", path: "/api/auth/oauth/*", purpose: RATE_LIMIT_PURPOSES.oauthIp },
  // 发起绑定（POST /api/auth/oauth/:slug/link）要校验当前密码或验证码：与其他再确认接口共用 reauth:ip，
  // 不占 OAuth 登录跳转的 oauth:ip 名额，猜密码的请求也不能借登录流程的名额绕开
  { method: "POST", path: "/api/auth/oauth/*", purpose: RATE_LIMIT_PURPOSES.reauthIp },
  { method: "POST", path: "/api/me/password", purpose: RATE_LIMIT_PURPOSES.reauthIp },
  { method: "POST", path: "/api/me/totp/*", purpose: RATE_LIMIT_PURPOSES.reauthIp },
  { method: "DELETE", path: "/api/me/totp/*", purpose: RATE_LIMIT_PURPOSES.reauthIp },
  { method: "POST", path: "/api/me/recovery-codes", purpose: RATE_LIMIT_PURPOSES.reauthIp },
  { method: "POST", path: "/api/me/passkeys/*", purpose: RATE_LIMIT_PURPOSES.passkeyManageIp },
  { method: "PATCH", path: "/api/me/passkeys/*", purpose: RATE_LIMIT_PURPOSES.passkeyManageIp },
  { method: "DELETE", path: "/api/me/passkeys/*", purpose: RATE_LIMIT_PURPOSES.passkeyManageIp },
];

/** 登录请求体读取上限（字节）：用户名与密码都有长度上限，4 KB 绰绰有余，超出直接 413 */
export const LOGIN_BODY_MAX_BYTES = 4096;

// ---- 定时任务（M7a，01 §2 cron） ----

/** 与 wrangler.jsonc 的 triggers.crons 保持一致 */
export const CRON_PREWARM = "*/5 * * * *";
export const CRON_DAILY_CLEANUP = "17 3 * * *";

/**
 * 每次预热最多取多少封新邮件、最多解析多少封。
 * 单封解析约十到几十毫秒 CPU，20 封远低于 Workers cron 的 CPU 上限；积压的邮件下个 5 分钟继续。
 */
export const PREWARM_BATCH_SIZE = 20;

/** 日志保留天数默认值（可被系统设置覆盖） */
export const ACCESS_LOG_RETENTION_DAYS_DEFAULT = 90;
export const AUDIT_LOG_RETENTION_DAYS_DEFAULT = 365;

/** 清理删除的分批大小与每张表每次运行的最大批数（超出的留给第二天，避免单次 DELETE 过大） */
export const CLEANUP_DELETE_BATCH_SIZE = 1000;
export const CLEANUP_MAX_BATCHES = 50;

/** 孤儿索引扫描：每批检查多少行、每次运行最多几批（游标记在 settings，扫完一圈回到 0） */
export const ORPHAN_SCAN_BATCH_SIZE = 500;
export const ORPHAN_SCAN_MAX_BATCHES = 20;

/** settings 里 cron 相关的键 */
export const CRON_SETTING_KEYS = {
  prewarmCursor: "system.cron.prewarm_after_id",
  orphanScanCursor: "system.cron.orphan_scan_after_id",
  lastRunPrewarm: "system.cron.prewarm.last_run",
  lastRunCleanup: "system.cron.cleanup.last_run",
} as const;

/** last_run.error 的长度上限 */
export const CRON_ERROR_MAX_LENGTH = 1000;

// ---- 系统设置、注册与 Turnstile（M6） ----

export { TURNSTILE_TOKEN_MAX_LENGTH } from "@maillink/shared";

/** Cloudflare Turnstile 服务端校验端点（固定地址，不来自任何配置） */
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** 校验请求的超时与响应体上限 */
export const TURNSTILE_FETCH_TIMEOUT_MS = 5000;
export const TURNSTILE_FETCH_MAX_BYTES = 16_384;

/** 取件链接默认轮询间隔（秒）的设置默认值 */
export const LINK_DEFAULT_POLL_INTERVAL_SEC = 30;

/** 审计里记录设置变更时，超过这个长度的字符串（如 data URI Logo）只记长度 */
export const SETTINGS_AUDIT_VALUE_MAX_LENGTH = 256;

/** links.default_expires_in_days 换算成秒的单位（一天） */
export const LINK_DEFAULT_EXPIRES_UNIT_SEC = SECONDS_PER_DAY;
