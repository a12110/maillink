import { Hono } from "hono";
import type { PublicConfig } from "@maillink/shared";
import { getSettings } from "../db/settings";
import type { AppEnv } from "../env";

export const publicRoutes = new Hono<AppEnv>();

// 本里程碑只返回站点名称、是否开放注册、可用登录方式；外观、Turnstile、OAuth 随 M5/M6 加入
publicRoutes.get("/config", async (c) => {
  const settings = await getSettings(c.env.APP_DB, ["site.name", "registration.enabled", "auth.login_methods"]);
  const body: PublicConfig = {
    site_name: settings["site.name"],
    registration_enabled: settings["registration.enabled"],
    login_methods: settings["auth.login_methods"],
  };
  return c.json(body);
});
