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

// ---- 邮件解析与索引（M2） ----

/**
 * 解析器版本。解析逻辑、词表（验证码关键词、分类关键词）任何改动都要递增：
 * mail_index 里版本不符的行会在下次访问时重建（01 §4.2）。
 */
export const PARSER_VERSION = 2;

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
