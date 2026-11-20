import type { PublicConfig } from "@maillink/shared";

/** 默认值对齐 packages/shared 的 publicConfigSchema（只开密码登录、不开注册、无 Turnstile）；各测试只写自己关心的字段 */
export function makePublicConfig(overrides: Partial<PublicConfig> = {}): PublicConfig {
  return {
    site_name: "MailLink",
    site_logo: "",
    site_description: "",
    site_footer: "",
    login_notice: "",
    pickup_notice: "",
    appearance: { preset: "default", accent: "#c8432b", mode: "system", radius: "8" },
    registration_enabled: false,
    login_methods: ["password"],
    oauth_providers: [],
    turnstile: { enabled: false, site_key: "", scopes: [] },
    password_min_length: 10,
    ...overrides,
  };
}
