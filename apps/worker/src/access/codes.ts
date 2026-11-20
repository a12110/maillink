import { mailIdentity, type MailIdentity, type MailIndexDbs } from "../mail-index";
import type { MailFacts } from "../mail-parse";
import { listCandidates } from "../mail-source";
import { limitToNewest } from "../rules";
import { scanNewestVisible } from "./newest";
import { effectivePolicy, type AccessScope } from "./policy";
import { scanVisible, type VisibleEntry } from "./scan";

// API 取码（PLAN"API 取码接口"）：在作用域 + 规则组 A 层（时间、过滤、max_mails、分类屏蔽）可见的邮件里，
// 按收到时间从新到旧取提取到验证码的邮件。验证码用求值时的提取结果（02 §4.6 的顺序），不看 present.extract。
// 与列表同一套扫描（02 §5）：遇到未就绪的邮件立即停，partial=true，它之后（更旧）的邮件都不算看过。

export type CodeEntry = {
  mail_id: number;
  code: string;
  received_at: number;
  recipient: string;
  facts: MailFacts;
  identity: MailIdentity;
};

export type RecentCodes = { entries: CodeEntry[]; partial: boolean };

export type RecentCodeOptions = {
  now: number;
  /** 只看这个时间（Unix 秒）及之后收到的；null 不限 */
  since: number | null;
  limit: number;
};

function codeOf(entry: VisibleEntry): string | null {
  return entry.evaluation.extracted?.code ?? null;
}

function toResult(visible: readonly VisibleEntry[], limit: number, partial: boolean): RecentCodes {
  const entries = limitToNewest(visible, undefined)
    .slice(0, limit)
    .map((entry) => ({
      mail_id: entry.mail_id,
      code: codeOf(entry) ?? missingCode(entry.mail_id),
      received_at: entry.received_at,
      recipient: entry.recipient,
      facts: entry.facts,
      identity: mailIdentity(entry),
    }));
  return { entries, partial };
}

function missingCode(mailId: number): never {
  throw new Error(`mail ${mailId}: 已按"有验证码"筛过却没有验证码`);
}

/** 时间下界与 since 取较晚者下推进 SQL；都没有为 null */
function sqlLowerBound(lowerBound: number | null, since: number | null): number | null {
  if (lowerBound === null) return since;
  return since === null ? lowerBound : Math.max(lowerBound, since);
}

export async function findRecentCodes(dbs: MailIndexDbs, scope: AccessScope, options: RecentCodeOptions): Promise<RecentCodes> {
  const { compiled, lowerBound } = effectivePolicy(scope, options.now);
  if (scope.addresses.length === 0) return { entries: [], partial: false };
  const { since } = options;
  const wanted = (entry: VisibleEntry) => codeOf(entry) !== null && (since === null || entry.received_at >= since);
  const maxMails = compiled.config.limits.max_mails;
  if (maxMails !== undefined) {
    // max_mails 先在全部可见邮件上截取最新 N 封（与列表同一口径），再从中挑有验证码的；since 不下推，免得越过这 N 封
    const { entries, scan } = await scanNewestVisible(dbs, scope.addresses, compiled, lowerBound, maxMails);
    return toResult(entries.filter(wanted), options.limit, scan.pending !== null);
  }
  const addresses = scope.addresses;
  const sqlSince = sqlLowerBound(lowerBound, since);
  const scan = await scanVisible(
    dbs,
    compiled,
    lowerBound,
    (last, limit) => listCandidates(dbs.MAIL_DB, { addresses, since: sqlSince, beforeId: last, limit }),
    options.limit,
    undefined,
    wanted,
  );
  return toResult(scan.visible, options.limit, scan.pending !== null);
}
