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

// ── 取件页 ──
/** 无任何操作多久后暂停自动刷新（给“继续刷新”） */
export const PICKUP_IDLE_PAUSE_MS = 5 * 60 * MS_PER_SECOND;
/** 新邮件卡片上“刚收到”标签保留多久（DESIGN.md：4s） */
export const PICKUP_FRESH_TAG_MS = 4000;
/** 验证码收到超过多久标“可能已过期”（DESIGN.md：10 分钟） */
export const PICKUP_STALE_CODE_SEC = 600;
/** code_only 视图里“更早收到的”最多显示几条 */
export const PICKUP_OLDER_CODES_SHOWN = 5;
/** 新邮件到达时的可选震动时长 */
export const PICKUP_VIBRATE_MS = 30;
/** 取件页倒计时与相对时间的刷新频率 */
export const PICKUP_TICK_MS = 1000;

// ── 取件链接管理 ──
/** 管理端取件链接列表每页条数（1440×900 一屏 16 行 + 表尾） */
export const LINKS_PAGE_SIZE = 16;
/** 侧板访问日志每次加载的条数 */
export const LINK_LOGS_PAGE_SIZE = 20;
/** 创建对话框里收件地址选择器每页条数 */
export const MAILBOX_PICKER_PAGE_SIZE = 30;
/** 链接预览一次最多看多少封邮件（后端默认 20，上限 100） */
export const LINK_PREVIEW_MAILS = 30;
