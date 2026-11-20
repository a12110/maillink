import {
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
  AdminPasswordReset,
  AdminUserCreate,
  AdminUserListQuery,
  AdminUserPatch,
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
  SessionResponse,
  SetupRequest,
  UpdateMeRequest,
} from "@maillink/shared";
import { HTTP_UNAUTHORIZED } from "./client";
import type { ApiClient } from "./client";
import { ApiError } from "./errors";
import { createAdminEndpoints } from "./endpoints-admin";
import { createSettingsEndpoints } from "./endpoints-settings";

function userPath(id: number, suffix = ""): string {
  return `/api/admin/users/${id}${suffix}`;
}

// 对外保持原来的导出位置
export { adminMailAttachmentPath, adminMailPath } from "./endpoints-admin";
export type { AdminMailDetailOptions } from "./endpoints-admin";
export type { SettingsInputByGroup } from "./endpoints-settings";

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

    ...createAdminEndpoints(client),
    ...createSettingsEndpoints(client),
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
