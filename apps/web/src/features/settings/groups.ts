import type { SettingGroup } from "@maillink/shared";

/** 设置页的左侧导航项：八个设置分组 + OAuth 提供方（后者不是 settings 分组，走自己的接口） */
export const OAUTH_NAV_KEY = "oauth";
export type SettingsNavKey = SettingGroup | typeof OAUTH_NAV_KEY;

export type SettingsNavItem = { key: SettingsNavKey; label: string; lead: string };

export const SETTINGS_NAV: readonly SettingsNavItem[] = [
  { key: "site", label: "站点信息", lead: "站点名称、Logo、描述与公告。登录页、取件页等免登录页面会直接显示。" },
  { key: "appearance", label: "外观", lead: "明暗模式、强调色与圆角。修改会即时预览，保存后对所有访问者生效。" },
  { key: "auth", label: "注册与登录", lead: "是否开放注册，以及允许哪些登录方式。" },
  { key: "turnstile", label: "人机验证", lead: "Cloudflare Turnstile：登录、注册与取件页的人机验证。" },
  { key: "oauth", label: "OAuth 提供方", lead: "第三方登录（OIDC / OAuth2）的提供方配置。" },
  { key: "security", label: "安全", lead: "管理员强制两步验证、会话时长与密码最小长度。" },
  { key: "links", label: "取件链接默认值", lead: "新建取件链接时的默认有效期、轮询间隔，以及取件页是否显示品牌。" },
  { key: "logs", label: "日志", lead: "访问日志与审计日志的保留天数，超期记录由定时任务清理。" },
  { key: "system", label: "系统状态", lead: "只读：邮件库探测结果、索引规模与定时任务运行情况。" },
];

export function findNavItem(key: string): SettingsNavItem | undefined {
  return SETTINGS_NAV.find((item) => item.key === key);
}
