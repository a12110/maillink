import {
  adminMailDetailSchema,
  adminMailListResponseSchema,
  adminSessionsRevokedSchema,
  adminUserListSchema,
  adminUserSchema,
  loginResponseSchema,
  meResponseSchema,
  mySessionListSchema,
  okResponseSchema,
  publicConfigSchema,
  sessionResponseSchema,
  setupStatusSchema,
} from "@maillink/shared";
import type {
  AdminMailListQuery,
  AdminPasswordReset,
  AdminUserCreate,
  AdminUserListQuery,
  AdminUserPatch,
  ChangePasswordRequest,
  LoginRequest,
  SessionResponse,
  SetupRequest,
  UpdateMeRequest,
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

export function createEndpoints(client: ApiClient) {
  const { request } = client;
  return {
    publicConfig: () => request({ path: "/api/public/config", schema: publicConfigSchema }),
    setupStatus: () => request({ path: "/api/setup/status", schema: setupStatusSchema }),
    setup: (body: SetupRequest) =>
      request({ method: "POST", path: "/api/setup", body, schema: okResponseSchema, handleUnauthorized: false }),

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
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
