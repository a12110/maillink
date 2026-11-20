import type { MailDbCompat } from "@maillink/shared";
import { getMailSchema } from "./schema-probe";

// MAIL_DB 兼容状态（temp_email 是否为带 to_address 的修改版），规格见 docs/dev/PLAN.md "temp_email 版本兼容提示"。
// 沿用 getMailSchema 的缓存语义：健康结果在 isolate 内缓存，不健康时每次重探；`refresh: true` 强制重探。

/**
 * 探测失败（绑定缺失、D1 故障）不抛出：初始化页必须能打开。错误写日志，响应里只带粗粒度错误码，
 * 因为 /api/setup/status 是公开接口，不能把 D1 的原始报错交出去。
 */
export async function getMailDbCompat(binding: D1Database, options: { refresh?: boolean } = {}): Promise<MailDbCompat> {
  const db: D1Database | undefined = binding;
  if (db === undefined) {
    console.error("MAIL_DB 兼容探测失败：没有绑定 MAIL_DB");
    return { status: "probe_failed", db_version: null, missing_required: [], error_code: "binding_missing" };
  }
  try {
    const probe = await getMailSchema(db, options);
    const status = !probe.healthy ? "unhealthy" : probe.capabilities.to_address ? "ok" : "no_icloud";
    return { status, db_version: probe.db_version, missing_required: probe.healthy ? [] : probe.missing_required };
  } catch (error) {
    console.error("MAIL_DB 兼容探测失败：查询抛错", error);
    return { status: "probe_failed", db_version: null, missing_required: [], error_code: "query_failed" };
  }
}
