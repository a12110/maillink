// M5 前后端共用的认证输入上限。worker 的 constants.ts 会重新导出这些值。

/** TOTP 验证码位数（RFC 6238） */
export const TOTP_DIGITS = 6;

/** 恢复码输入的长度上限（含用户可能输入的空格与连字符） */
export const RECOVERY_CODE_INPUT_MAX_LENGTH = 32;

/** 通行密钥名称长度上限 */
export const PASSKEY_NAME_MAX_LENGTH = 64;

/** OAuth 提供方配置的长度上限 */
export const OAUTH_SLUG_MAX_LENGTH = 32;
export const OAUTH_NAME_MAX_LENGTH = 64;
export const OAUTH_ICON_MAX_LENGTH = 2048;
export const OAUTH_SCOPES_MAX_LENGTH = 512;
export const OAUTH_URL_MAX_LENGTH = 2048;
export const OAUTH_CLIENT_ID_MAX_LENGTH = 512;
export const OAUTH_CLIENT_SECRET_MAX_LENGTH = 2048;

/** 提供方 slug：小写字母数字开头，可含连字符；出现在回调路径里 */
export const OAUTH_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** WebAuthn 响应里 base64url 字段的长度上限（attestationObject 可能带证书链，给足余量） */
export const WEBAUTHN_FIELD_MAX_LENGTH = 65_536;
