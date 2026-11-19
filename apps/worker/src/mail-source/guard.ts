import type { MailSchemaProbe } from "@maillink/shared";
import { ApiError } from "../errors";
import { HTTP_SERVICE_UNAVAILABLE } from "../http-status";
import { getMailSchema } from "./schema-probe";

export const MAIL_DB_UNHEALTHY_CODE = "mail_db_unhealthy";

/**
 * 邮件相关查询的入口检查（01 §3.1）：首次调用即探测并缓存，必需列缺失时抛 503。
 * 探测本身失败（绑定缺失、D1 故障）原样抛出，不转成"不健康"。
 */
export async function requireMailSchema(db: D1Database): Promise<MailSchemaProbe> {
  const probe = await getMailSchema(db);
  if (!probe.healthy) {
    const detail = probe.table_exists
      ? `缺少必需列：${probe.missing_required.join("、")}`
      : "raw_mails 表不存在";
    throw new ApiError(HTTP_SERVICE_UNAVAILABLE, MAIL_DB_UNHEALTHY_CODE, `MAIL_DB 不可用，${detail}`);
  }
  return probe;
}
