import {
  adminMailboxListResponseSchema,
  adminMailboxSchema,
  adminMailDetailSchema,
  adminMailListResponseSchema,
  adminRuleGroupDetailSchema,
  adminRuleGroupListSchema,
  auditLogListSchema,
  mailboxBatchResponseSchema,
  mailboxImportResponseSchema,
  okResponseSchema,
  ruleGroupSaveResponseSchema,
  ruleGroupTestResponseSchema,
} from "@maillink/shared";
import type {
  AdminMailboxListQuery,
  AdminMailListQuery,
  AuditLogListQuery,
  MailboxBatchRequest,
  MailboxImportRequest,
  MailboxPatch,
  RuleGroupCreate,
  RuleGroupTestRequest,
  RuleGroupUpdate,
} from "@maillink/shared";
import type { ApiClient } from "./client";
import { ruleDraftSchema } from "./rule-draft";

export function adminMailPath(id: number): string {
  return `/api/admin/mails/${id}`;
}

export function adminMailAttachmentPath(id: number, index: number): string {
  return `${adminMailPath(id)}/attachments/${index}`;
}

const MAILBOXES_PATH = "/api/admin/mailboxes";
const RULE_GROUPS_PATH = "/api/admin/rule-groups";

export type AdminMailDetailOptions = { raw: boolean; remoteImages: boolean };

/** 邮件相关的管理端接口：全部邮件、收件地址、规则组（含测试器）、审计日志 */
export function createAdminEndpoints({ request }: ApiClient) {
  return {
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
