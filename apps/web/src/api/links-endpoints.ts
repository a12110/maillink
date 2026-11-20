import {
  adminRuleGroupListSchema,
  adminShareLinkSchema,
  linkLogListResponseSchema,
  linkPreviewResponseSchema,
  shareLinkBatchResponseSchema,
  shareLinkCreateResponseSchema,
  shareLinkExportResponseSchema,
  shareLinkListResponseSchema,
  shareLinkRotateResponseSchema,
  shareLinkTokenSchema,
} from "@maillink/shared";
import type {
  ShareLinkBatch,
  ShareLinkCreate,
  ShareLinkExport,
  ShareLinkListQuery,
  ShareLinkRebind,
  ShareLinkReset,
  ShareLinkRotate,
  ShareLinkUpdate,
} from "@maillink/shared";
import type { ApiClient } from "./client";

// 管理端取件链接接口（UI-5）。独立成文件，由 endpoints.ts 一行展开，减少与其他 UI 任务并发追加时的冲突。

const BASE = "/api/admin/links";

export function createLinkEndpoints(client: ApiClient) {
  const { request } = client;
  return {
    listLinks: (query: ShareLinkListQuery) => request({ path: BASE, query, schema: shareLinkListResponseSchema }),
    getLink: (id: number) => request({ path: `${BASE}/${id}`, schema: adminShareLinkSchema }),
    /** 响应里含完整 token / url，只此一次 */
    createLinks: (body: ShareLinkCreate) => request({ method: "POST", path: BASE, body, schema: shareLinkCreateResponseSchema }),
    updateLink: (id: number, body: ShareLinkUpdate) => request({ method: "PATCH", path: `${BASE}/${id}`, body, schema: adminShareLinkSchema }),
    /** 取完整链接：服务端写审计 */
    linkToken: (id: number) => request({ path: `${BASE}/${id}/token`, schema: shareLinkTokenSchema }),
    linkLogs: (id: number, query: { cursor?: string; limit?: number }) =>
      request({ path: `${BASE}/${id}/logs`, query, schema: linkLogListResponseSchema }),
    rotateLink: (id: number, body: ShareLinkRotate) =>
      request({ method: "POST", path: `${BASE}/${id}/rotate`, body, schema: shareLinkRotateResponseSchema }),
    rebindLink: (id: number, body: ShareLinkRebind) => request({ method: "POST", path: `${BASE}/${id}/rebind`, body, schema: adminShareLinkSchema }),
    resetLink: (id: number, body: ShareLinkReset) => request({ method: "POST", path: `${BASE}/${id}/reset`, body, schema: adminShareLinkSchema }),
    previewLink: (id: number, limit?: number) => request({ path: `${BASE}/${id}/preview`, query: { limit }, schema: linkPreviewResponseSchema }),
    batchLinks: (body: ShareLinkBatch) => request({ method: "POST", path: `${BASE}/batch`, body, schema: shareLinkBatchResponseSchema }),
    exportLinks: (body: ShareLinkExport) => request({ method: "POST", path: `${BASE}/export`, body, schema: shareLinkExportResponseSchema }),
    /** 选规则组 / 筛选用 */
    listRuleGroupChoices: () => request({ path: "/api/admin/rule-groups", schema: adminRuleGroupListSchema }),
  };
}
