import { Hono } from "hono";
import type { PublicConfig } from "@maillink/shared";
import { listEnabledProviders } from "../db/oauth-providers";
import { getSettings } from "../db/settings";
import type { AppEnv } from "../env";

export const publicRoutes = new Hono<AppEnv>();

// 免登录可读的"公开"设置（03 §7）：站点信息、外观、是否开放注册、Turnstile 的启用状态 / site key / 作用范围、
// 可用登录方式与已启用的 OAuth 提供方（仅 slug、名称、图标）、密码最小长度（注册页提示用）。
// secret、其余安全设置、取件链接默认值一律不在这里。
// login_methods 以设置 auth.login_methods 为准；没有启用中的提供方时不列出 oauth。
// 取件页公告 pickup_notice 在这里；"取件页是否显示站点品牌"不是公开设置，由 GET /api/s/:token 带出。
const PUBLIC_KEYS = [
  "site.name",
  "site.logo",
  "site.description",
  "site.footer",
  "site.login_notice",
  "site.pickup_notice",
  "appearance.preset",
  "appearance.accent",
  "appearance.mode",
  "appearance.radius",
  "registration.enabled",
  "auth.login_methods",
  "turnstile.enabled",
  "turnstile.site_key",
  "turnstile.scopes",
  "security.password_min_length",
] as const;

publicRoutes.get("/config", async (c) => {
  const db = c.env.APP_DB;
  const settings = await getSettings(db, PUBLIC_KEYS);
  const allowed = settings["auth.login_methods"];
  const providers = allowed.includes("oauth") ? await listEnabledProviders(db) : [];
  const body: PublicConfig = {
    site_name: settings["site.name"],
    site_logo: settings["site.logo"],
    site_description: settings["site.description"],
    site_footer: settings["site.footer"],
    login_notice: settings["site.login_notice"],
    pickup_notice: settings["site.pickup_notice"],
    appearance: {
      preset: settings["appearance.preset"],
      accent: settings["appearance.accent"],
      mode: settings["appearance.mode"],
      radius: settings["appearance.radius"],
    },
    registration_enabled: settings["registration.enabled"],
    login_methods: allowed.filter((method) => method !== "oauth" || providers.length > 0),
    oauth_providers: providers.map((row) => ({ slug: row.slug, name: row.name, icon: row.icon })),
    turnstile: {
      enabled: settings["turnstile.enabled"],
      site_key: settings["turnstile.site_key"],
      scopes: settings["turnstile.scopes"],
    },
    password_min_length: settings["security.password_min_length"],
  };
  return c.json(body);
});
