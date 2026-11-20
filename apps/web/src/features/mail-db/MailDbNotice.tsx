import { useQuery } from "@tanstack/react-query";
import type { MailDbCompat } from "@maillink/shared";
import { adminMailDbQuery } from "../../api/queries";
import { describeError } from "../../lib/messages";
import { Callout, ErrorCallout } from "../../ui";
import {
  NO_ICLOUD_ADMIN_SUFFIX,
  NO_ICLOUD_BODY,
  NO_ICLOUD_IMPORT_EMPHASIS,
  NO_ICLOUD_SETUP_SUFFIX,
  NO_ICLOUD_TITLE,
  PROBE_FAILED_TITLE,
  UNHEALTHY_TITLE,
} from "./notice-text";

type Where = "setup" | "admin";

type NoticeProps = {
  compat: MailDbCompat;
  /** setup：初始化页，说明"初始化后"的后果、提示刷新确认；admin：初始化后的管理页 */
  where: Where;
  /** 导入对话框里用户粘贴了 iCloud 地址时，在 no_icloud 提示后补一句 */
  emphasizeIcloud?: boolean;
};

function unhealthyText(compat: MailDbCompat, where: Where): string {
  const columns = compat.missing_required.length > 0 ? `缺少的表或列：${compat.missing_required.join("、")}。` : "";
  const effect = where === "setup" ? "初始化后将无法读取邮件" : "当前无法读取邮件";
  return `raw_mails 表不存在或缺少必需列，${effect}。${columns}请确认 MAIL_DB 绑定的是 cloudflare_temp_email 使用的 D1 数据库及其版本。`;
}

function probeFailedText(compat: MailDbCompat, where: Where): string {
  const effect = where === "setup" ? "初始化后可能无法读取邮件" : "当前可能无法读取邮件";
  return `探测查询失败，${effect}（${compat.error_code ?? "unknown"}）。详细原因见 Worker 日志。`;
}

/** 邮件库兼容提示：ok 不显示；no_icloud 是警告；unhealthy / probe_failed 是错误。都不阻断操作 */
export function MailDbNotice({ compat, where, emphasizeIcloud = false }: NoticeProps) {
  switch (compat.status) {
    case "ok":
      return null;
    case "no_icloud":
      return (
        <Callout tone="warning" title={NO_ICLOUD_TITLE}>
          {NO_ICLOUD_BODY}
          {where === "setup" ? NO_ICLOUD_SETUP_SUFFIX : NO_ICLOUD_ADMIN_SUFFIX}
          {emphasizeIcloud ? <> <b>{NO_ICLOUD_IMPORT_EMPHASIS}</b></> : null}
        </Callout>
      );
    case "unhealthy":
      return <Callout tone="danger" title={UNHEALTHY_TITLE}>{unhealthyText(compat, where)}</Callout>;
    case "probe_failed":
      return <Callout tone="danger" title={PROBE_FAILED_TITLE}>{probeFailedText(compat, where)}</Callout>;
  }
}

/** 初始化后的常驻提示：管理员接口查询；失败就地显示错误，不当作"兼容"；加载中不占位 */
export function AdminMailDbNotice({ emphasizeIcloud = false }: { emphasizeIcloud?: boolean }) {
  const query = useQuery(adminMailDbQuery());
  if (query.isError) {
    return <ErrorCallout title="无法确认邮件库兼容性" {...describeError(query.error)} onRetry={() => void query.refetch()} />;
  }
  if (!query.data) return null;
  return <MailDbNotice compat={query.data} where="admin" emphasizeIcloud={emphasizeIcloud} />;
}
