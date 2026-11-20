import {
  adminMailboxListResponseSchema,
  adminMailboxSchema,
  adminMailDetailSchema,
  adminMailListResponseSchema,
  adminRuleGroupDetailSchema,
  adminRuleGroupListSchema,
  adminSessionsRevokedSchema,
  adminUserListSchema,
  adminUserSchema,
  auditLogListSchema,
  loginResponseSchema,
  mailboxBatchResponseSchema,
  mailboxImportResponseSchema,
  meResponseSchema,
  mySessionListSchema,
  okResponseSchema,
  publicConfigSchema,
  ruleGroupSaveResponseSchema,
  ruleGroupTestResponseSchema,
  sessionResponseSchema,
  setupStatusSchema,
} from "@maillink/shared";
import type {
  AdminMailboxListQuery,
  AdminMailListQuery,
  AdminPasswordReset,
  AdminUserCreate,
  AdminUserListQuery,
  AdminUserPatch,
  AuditLogListQuery,
  ChangePasswordRequest,
  LoginRequest,
  MailboxBatchRequest,
  MailboxImportRequest,
  MailboxPatch,
  RuleGroupCreate,
  RuleGroupTestRequest,
  RuleGroupUpdate,
  SessionResponse,
  SetupRequest,
  UpdateMeRequest,
} from "@maillink/shared";
import { HTTP_UNAUTHORIZED } from "./client";
import type { ApiClient } from "./client";
import { ApiError } from "./errors";
import { ruleDraftSchema } from "./rule-draft";

function userPath(id: number, suffix = ""): string {
  return `/api/admin/users/${id}${suffix}`;
}

export function adminMailPath(id: number): string {
  return `/api/admin/mails/${id}`;
}

export function adminMailAttachmentPath(id: number, index: number): string {
  return `${adminMailPath(id)}/attachments/${index}`;
}

const MAILBOXES_PATH = "/api/admin/mailboxes";
const RULE_GROUPS_PATH = "/api/admin/rule-groups";

export type AdminMailDetailOptions = { raw: boolean; remoteImages: boolean };

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
    /** raw=true 时响应多一个 raw 字段（邮件原文）；remoteImages=true 时 HTML 允许加载远程图片 */
    getAdminMail: (id: number, { raw, remoteImages }: AdminMailDetailOptions) =>
      request({
        path: adminMailPath(id),
        query: { raw: raw ? 1 : undefined, remote_images: remoteImages ? "allow" : undefined },
        schema: adminMailDetailSchema,
      }),

    listMailboxes: (query: AdminMailboxListQuery) =>
      request({ path: MAILBOXES_PATH, query, schema: adminMailboxListResponseSchema }),
    importMailboxes: (body: MailboxImportRequest) =>
      request({ method: "POST", path: `${MAILBOXES_PATH}/import`, body, schema: mailboxImportResponseSchema }),
    patchMailbox: (id: number, body: MailboxPatch) =>
      request({ method: "PATCH", path: `${MAILBOXES_PATH}/${id}`, body, schema: adminMailboxSchema }),
    batchMailboxes: (body: MailboxBatchRequest) =>
      request({ method: "POST", path: `${MAILBOXES_PATH}/batch`, body, schema: mailboxBatchResponseSchema }),

    listRuleGroups: () => request({ path: RULE_GROUPS_PATH, schema: adminRuleGroupListSchema }),
    getRuleGroup: (id: number) => request({ path: `${RULE_GROUPS_PATH}/${id}`, schema: adminRuleGroupDetailSchema }),
    createRuleGroup: (body: RuleGroupCreate) =>
      request({ method: "POST", path: RULE_GROUPS_PATH, body, schema: ruleGroupSaveResponseSchema }),
    updateRuleGroup: (id: number, body: RuleGroupUpdate) =>
      request({ method: "PUT", path: `${RULE_GROUPS_PATH}/${id}`, body, schema: ruleGroupSaveResponseSchema }),
    deleteRuleGroup: (id: number) =>
      request({ method: "DELETE", path: `${RULE_GROUPS_PATH}/${id}`, schema: okResponseSchema }),
    testRuleGroup: (body: RuleGroupTestRequest) =>
      request({ method: "POST", path: `${RULE_GROUPS_PATH}/test`, body, schema: ruleGroupTestResponseSchema }),
    draftRuleFromMail: (mailId: number) =>
      request({ method: "POST", path: `${RULE_GROUPS_PATH}/draft-from-mail`, body: { mail_id: mailId }, schema: ruleDraftSchema }),

    listAuditLogs: (query: AuditLogListQuery) =>
      request({ path: "/api/admin/audit-logs", query, schema: auditLogListSchema }),
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
