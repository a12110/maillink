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
/** 工作区侧栏折叠断点，与 theme.css 的 --breakpoint-lg 一致 */
export const DESKTOP_MIN_WIDTH_PX = 1024;
export const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH_PX}px)`;

export const MS_PER_SECOND = 1000;
