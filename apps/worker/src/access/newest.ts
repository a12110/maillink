import { SCAN_CAP_PER_REQUEST } from "../constants";
import type { MailIndexDbs } from "../mail-index";
import { listCandidates } from "../mail-source";
import { limitToNewest, type CompiledRuleGroup } from "../rules";
import { scanVisible, type ScanResult, type VisibleEntry } from "./scan";

// limits.max_mails（02 §3.1"过滤后只保留最新的 N 封，没有更多分页"）的唯一判定：
// 从新到旧扫描凑够 N 封可见邮件，再按 limitToNewest（received_at 降序、同秒 mail_id 降序，与测试器同一口径）截取。
// 列表首页、设了 max_mails 时的增量轮询、详情与附件都用它，访客改 cursor / after_id 都拿不到这 N 封以外的邮件。

export type NewestVisible = { entries: VisibleEntry[]; scan: ScanResult };

export async function scanNewestVisible(
  dbs: MailIndexDbs,
  addresses: string[],
  compiled: CompiledRuleGroup,
  lowerBound: number | null,
  maxMails: number,
): Promise<NewestVisible> {
  const scan = await scanVisible(
    dbs,
    compiled,
    lowerBound,
    (last, limit) => listCandidates(dbs.MAIL_DB, { addresses, since: lowerBound, beforeId: last, limit }),
    Math.min(maxMails, SCAN_CAP_PER_REQUEST),
  );
  return { entries: limitToNewest(scan.visible, maxMails), scan };
}
