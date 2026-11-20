import { Hono } from "hono";
import type { PublicConfig } from "@maillink/shared";
import { listEnabledProviders } from "../db/oauth-providers";
import { getSettings } from "../db/settings";
import type { AppEnv } from "../env";

export const publicRoutes = new Hono<AppEnv>();

// 站点名称、是否开放注册、可用登录方式与已启用的 OAuth 提供方（仅 slug、名称、图标）。外观、Turnstile 随 M6 加入。
// login_methods 以设置 auth.login_methods 为准；没有启用中的提供方时不列出 oauth。
publicRoutes.get("/config", async (c) => {
  const db = c.env.APP_DB;
  const settings = await getSettings(db, ["site.name", "registration.enabled", "auth.login_methods"]);
  const allowed = settings["auth.login_methods"];
  const providers = allowed.includes("oauth") ? await listEnabledProviders(db) : [];
  const body: PublicConfig = {
    site_name: settings["site.name"],
    registration_enabled: settings["registration.enabled"],
    login_methods: allowed.filter((method) => method !== "oauth" || providers.length > 0),
    oauth_providers: providers.map((row) => ({ slug: row.slug, name: row.name, icon: row.icon })),
  };
  return c.json(body);
});
