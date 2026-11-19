// 前后端共用的输入规则。worker 的 constants.ts 会重新导出这些值，业务代码从 constants.ts 取。

/** 用户名长度（字符数） */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

/** 用户名字符集：字母数字开头，其后可含 . _ -（不含空白与 @，避免和邮箱混淆） */
export const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** 密码长度（字符数）。上限防止超长输入拖慢哈希 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const DISPLAY_NAME_MAX_LENGTH = 64;

/** RFC 5321 对邮箱地址的长度上限 */
export const EMAIL_MAX_LENGTH = 254;

/** 用户列表关键词长度上限 */
export const SEARCH_KEYWORD_MAX_LENGTH = 64;

/** 列表单页条数上限 */
export const LIST_PAGE_SIZE_MAX = 100;
