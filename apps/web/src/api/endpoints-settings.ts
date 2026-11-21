import {
  adminOAuthProviderListSchema,
  adminOAuthProviderSchema,
  appearanceSettingsSchema,
  authSettingsSchema,
  linksSettingsSchema,
  logsSettingsSchema,
  oauthDiscoverResponseSchema,
  oauthProviderChangeResponseSchema,
  prewarmSettingsSchema,
  securitySettingsSchema,
  siteSettingsSchema,
  systemSettingsSchema,
  turnstileSettingsSchema,
} from "@maillink/shared";
import type { z } from "zod";
import type {
  OAuthProviderCreate,
  OAuthProviderUpdate,
  SettingGroup,
  SettingsByGroup,
  TurnstileSettingsInput,
  WritableSettingGroup,
} from "@maillink/shared";
import type { ApiClient } from "./client";

/** 每个设置分组 GET 响应的 schema；satisfies 保证它们与 SettingsByGroup 的类型一一对应 */
const SETTINGS_RESPONSE_SCHEMAS = {
  site: siteSettingsSchema,
  appearance: appearanceSettingsSchema,
  auth: authSettingsSchema,
  turnstile: turnstileSettingsSchema,
  security: securitySettingsSchema,
  links: linksSettingsSchema,
  logs: logsSettingsSchema,
  prewarm: prewarmSettingsSchema,
  system: systemSettingsSchema,
} as const satisfies { [G in SettingGroup]: z.ZodType<SettingsByGroup[G]> };

/** PUT 的请求体类型：与 GET 相同，只有 turnstile 多一个可选 secret（GET 里是 secret_set） */
export type SettingsInputByGroup = Omit<SettingsByGroup, "system" | "turnstile"> & { turnstile: TurnstileSettingsInput };

function oauthProviderPath(id: number): string {
  return `/api/admin/oauth-providers/${id}`;
}

/** 系统设置与 OAuth 提供方的管理端接口 */
export function createSettingsEndpoints({ request }: ApiClient) {
  return {
    // 单个 schema 对应单个分组；按分组名取 schema 时 TS 无法把联合收窄回 SettingsByGroup[G]，所以在这一处断言
    getSettings: <G extends SettingGroup>(group: G): Promise<SettingsByGroup[G]> =>
      request({ path: `/api/admin/settings/${group}`, schema: SETTINGS_RESPONSE_SCHEMAS[group] }) as Promise<SettingsByGroup[G]>,
    putSettings: <G extends WritableSettingGroup>(group: G, body: SettingsInputByGroup[G]): Promise<SettingsByGroup[G]> =>
      request({
        method: "PUT",
        path: `/api/admin/settings/${group}`,
        body,
        schema: SETTINGS_RESPONSE_SCHEMAS[group],
      }) as Promise<SettingsByGroup[G]>,

    listOAuthProviders: () => request({ path: "/api/admin/oauth-providers", schema: adminOAuthProviderListSchema }),
    createOAuthProvider: (body: OAuthProviderCreate) =>
      request({ method: "POST", path: "/api/admin/oauth-providers", body, schema: adminOAuthProviderSchema }),
    updateOAuthProvider: (id: number, body: OAuthProviderUpdate) =>
      request({ method: "PUT", path: oauthProviderPath(id), body, schema: oauthProviderChangeResponseSchema }),
    deleteOAuthProvider: (id: number) =>
      request({ method: "DELETE", path: oauthProviderPath(id), schema: oauthProviderChangeResponseSchema }),
    discoverOAuthIssuer: (issuer: string) =>
      request({ method: "POST", path: "/api/admin/oauth-providers/discover", body: { issuer }, schema: oauthDiscoverResponseSchema }),
  };
}
