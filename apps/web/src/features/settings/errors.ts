import { describeErrorWith } from "../../lib/api-error-text";
import type { ErrorTexts } from "../../lib/api-error-text";

/** 系统设置与 OAuth 提供方接口的错误说明；有动态信息（字段名、数量）的拼上服务端原文 */
export const SETTINGS_ERROR_TEXTS: ErrorTexts = {
  accent_unreachable: (server) =>
    `这个强调色无法保证按钮与文字的清晰度（明暗两套主题都要达到对比度要求），请换一个颜色。${server}`,
  login_methods_lockout: (server) =>
    `不能保存：按这组设置没有任何启用的管理员还能登录，会把所有管理员锁在系统外。${server}`,
  admin_2fa_lockout: (server) =>
    `不能保存：这会让所有管理员都过不了两步验证要求。先让某个管理员启用 TOTP 或登记通行密钥，再改这项。${server}`,
  turnstile_incomplete: (server) => `启用人机验证前要先填完整：site key、secret，并至少选一个作用范围。${server}`,
  validation_error: (server) => `服务器认为有些值不合法：${server}`,
  group_read_only: "系统状态是只读的，没有可保存的内容。",
  not_found: "找不到这个设置分组或提供方，可能已被删除。",
  forbidden: "需要管理员权限。",
  oauth_provider_has_identities: (server) =>
    `这个提供方已经有用户绑定，改动 issuer、端点、client_id 或类型可能让同一个 subject 对应到另一个人，所以被拒绝。${server}`,
  oauth_slug_taken: "slug 已被其他提供方使用，请换一个。",
  oauth_provider_invalid: (server) => `提供方配置不完整：${server}`,
  oauth_url_rejected: (server) => `地址被拒绝（必须是公网 https 地址，不能是 IP 或内网主机）：${server}`,
  oauth_discovery_failed: (server) => `无法从 issuer 读取发现文档：${server}`,
};

export function describeSettingsError(error: unknown): { message: string; detail: string } {
  return describeErrorWith(SETTINGS_ERROR_TEXTS, error);
}
