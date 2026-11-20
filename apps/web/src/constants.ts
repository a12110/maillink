// 前端集中常量：时长、分页、断点。尺寸类取值在 styles/layout.css 与 tokens.css（令牌），这里只放 JS 需要的。

export const APP_NAME = "MailLink";

/** Toast 自动消失时长（DESIGN.md：2.2s） */
export const TOAST_DURATION_MS = 2200;
/** 搜索框输入停顿多久后才发请求 */
export const SEARCH_DEBOUNCE_MS = 300;
/** 会话 / 公开配置缓存新鲜期 */
export const SESSION_STALE_MS = 30_000;
/** 管理端用户列表每页条数：1440×900 一屏 16 行 + 表尾（DESIGN.md「密度」） */
export const USERS_PAGE_SIZE = 16;
/** 管理端“全部邮件”每页条数（与后端默认 LIST_PAGE_SIZE 一致） */
export const MAILS_PAGE_SIZE = 20;
/** 收件地址表每页条数：1440×900 一屏 16 行 + 表尾 */
export const MAILBOXES_PAGE_SIZE = 16;
/** 「选择全部」逐页取地址时每页条数（后端上限） */
export const MAILBOX_WALK_PAGE_SIZE = 100;
/** 审计日志每页条数 */
export const AUDIT_PAGE_SIZE = 30;
/** 规则测试器：配置改动后停多久再试跑 */
export const TESTER_DEBOUNCE_MS = 600;
/** 导入预览里每个分组最多渲染的行数（超出只写“还有 N 条”，避免一次渲染 2000 行） */
export const IMPORT_PREVIEW_ROWS = 100;
/** 邮件详情缓存新鲜期：邮件内容不会变，只有解析器升级才会不同 */
export const MAIL_DETAIL_STALE_MS = 60_000;
/** `partial` 重取的退避（DESIGN.md：1s / 2s / 4s，最多 3 次） */
export const PARTIAL_RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];
/** 邮件筛选文本的长度上限，与后端 adminMailListQuerySchema 一致（RFC 5321 邮箱长度上限） */
export const MAIL_FILTER_TEXT_MAX = 254;
/** 原文视图最多渲染的字符数；超出部分不渲染，但“复制原文”复制完整内容 */
export const RAW_PREVIEW_MAX_CHARS = 200_000;
/** 工作区侧栏折叠断点，与 theme.css 的 --breakpoint-lg 一致 */
export const DESKTOP_MIN_WIDTH_PX = 1024;
export const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH_PX}px)`;

export const MS_PER_SECOND = 1000;
