import {
  adminMailDetailSchema,
  adminMailListResponseSchema,
  adminSessionsRevokedSchema,
  adminUserListSchema,
  adminOAuthProviderListSchema,
  adminUserSchema,
  appearanceSettingsSchema,
  authSettingsSchema,
  linksSettingsSchema,
  loginResponseSchema,
  logsSettingsSchema,
  meResponseSchema,
  mySessionListSchema,
  oauthDiscoverResponseSchema,
  oauthProviderChangeResponseSchema,
  adminOAuthProviderSchema,
  okResponseSchema,
  publicConfigSchema,
  securitySettingsSchema,
  sessionResponseSchema,
  setupStatusSchema,
  siteSettingsSchema,
  systemSettingsSchema,
  turnstileSettingsSchema,
} from "@maillink/shared";
import type { z } from "zod";
import type {
  AdminMailListQuery,
  AdminPasswordReset,
  AdminUserCreate,
  AdminUserListQuery,
  AdminUserPatch,
  ChangePasswordRequest,
  LoginRequest,
  OAuthProviderCreate,
  OAuthProviderUpdate,
  RegisterRequest,
  SessionResponse,
  SettingGroup,
  SettingsByGroup,
  SetupRequest,
  TurnstileSettingsInput,
  UpdateMeRequest,
  WritableSettingGroup,
} from "@maillink/shared";
import { HTTP_UNAUTHORIZED } from "./client";
import type { ApiClient } from "./client";
import { ApiError } from "./errors";

function userPath(id: number, suffix = ""): string {
  return `/api/admin/users/${id}${suffix}`;
}

export function adminMailPath(id: number): string {
  return `/api/admin/mails/${id}`;
}

export function adminMailAttachmentPath(id: number, index: number): string {
  return `${adminMailPath(id)}/attachments/${index}`;
}

/** 每个设置分组 GET 响应的 schema；satisfies 保证它们与 SettingsByGroup 的类型一一对应 */
const SETTINGS_RESPONSE_SCHEMAS = {
  site: siteSettingsSchema,
  appearance: appearanceSettingsSchema,
  auth: authSettingsSchema,
  turnstile: turnstileSettingsSchema,
  security: securitySettingsSchema,
  links: linksSettingsSchema,
  logs: logsSettingsSchema,
  system: systemSettingsSchema,
} as const satisfies { [G in SettingGroup]: z.ZodType<SettingsByGroup[G]> };

/** PUT 的请求体类型：与 GET 相同，只有 turnstile 多一个可选 secret（GET 里是 secret_set） */
export type SettingsInputByGroup = Omit<SettingsByGroup, "system" | "turnstile"> & { turnstile: TurnstileSettingsInput };

function oauthProviderPath(id: number): string {
  return `/api/admin/oauth-providers/${id}`;
}

export function createEndpoints(client: ApiClient) {
  const { request } = client;
  return {
    publicConfig: () => request({ path: "/api/public/config", schema: publicConfigSchema }),
    setupStatus: () => request({ path: "/api/setup/status", schema: setupStatusSchema }),
    setup: (body: SetupRequest) =>
      request({ method: "POST", path: "/api/setup", body, schema: okResponseSchema, handleUnauthorized: false }),

    /** 注册关闭时后端 404；成功即已登录（201 + 会话 Cookie） */
    register: (body: RegisterRequest) =>
      request({ method: "POST", path: "/api/auth/register", body, schema: okResponseSchema, handleUnauthorized: false }),

    login: (body: LoginRequest) =>
      request({ method: "POST", path: "/api/auth/login", body, schema: loginResponseSchema, handleUnauthorized: false }),
    logout: () => request({ method: "POST", path: "/api/auth/logout", schema: okResponseSchema }),
    /** 未登录是正常状态：401 返回 null，其他错误照常抛出 */
    session: async (): Promise<SessionResponse | null> => {
      try {
        return await request({ path: "/api/auth/session", schema: sessionResponseSchema, handleUnauthorized: false });
      } catch (error) {
        if (error instanceof ApiError && error.status === HTTP_UNAUTHORIZED) return null;
        throw error;
      }
    },

    me: () => request({ path: "/api/me", schema: meResponseSchema }),
    updateMe: (body: UpdateMeRequest) => request({ method: "PATCH", path: "/api/me", body, schema: meResponseSchema }),
    changePassword: (body: ChangePasswordRequest) =>
      request({ method: "POST", path: "/api/me/password", body, schema: okResponseSchema }),
    mySessions: () => request({ path: "/api/me/sessions", schema: mySessionListSchema }),
    revokeMySession: (id: string) =>
      request({ method: "DELETE", path: `/api/me/sessions/${encodeURIComponent(id)}`, schema: okResponseSchema }),

    listUsers: (query: AdminUserListQuery) =>
      request({ path: "/api/admin/users", query, schema: adminUserListSchema }),
    getUser: (id: number) => request({ path: userPath(id), schema: adminUserSchema }),
    createUser: (body: AdminUserCreate) =>
      request({ method: "POST", path: "/api/admin/users", body, schema: adminUserSchema }),
    patchUser: (id: number, body: AdminUserPatch) =>
      request({ method: "PATCH", path: userPath(id), body, schema: adminUserSchema }),
    deleteUser: (id: number) => request({ method: "DELETE", path: userPath(id), schema: okResponseSchema }),
    resetUserPassword: (id: number, body: AdminPasswordReset) =>
      request({ method: "POST", path: userPath(id, "/password"), body, schema: okResponseSchema }),
    revokeUserSessions: (id: number) =>
      request({ method: "DELETE", path: userPath(id, "/sessions"), schema: adminSessionsRevokedSchema }),

    listAdminMails: (query: AdminMailListQuery) =>
      request({ path: "/api/admin/mails", query, schema: adminMailListResponseSchema }),
    /** raw=true 时响应多一个 raw 字段（邮件原文） */
    getAdminMail: (id: number, raw: boolean) =>
      request({ path: adminMailPath(id), query: { raw: raw ? 1 : undefined }, schema: adminMailDetailSchema }),

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

export type Endpoints = ReturnType<typeof createEndpoints>;
