import type { RuleEvaluation, RuleGroupTestItem } from "@maillink/shared";
import { getOrBuild, mailIdentity, type IndexedItem, type MailIdentity, type MailIndexDbs } from "../mail-index";
import { getCandidatesByIds, listCandidates } from "../mail-source";
import { presentListItem } from "../render";
import { computeTimeLowerBound, limitToNewest, type CompiledRuleGroup, type TimeAnchors } from "../rules";
import { evaluateIndexed } from "./policy";

// 规则测试器（02 §8）：用未保存的配置对最近 N 封邮件试跑，逐封给出结果、原因、命中规则与访问者视角的预览。
// 求值与呈现用的是列表流水线同一套函数（evaluateIndexed / limitToNewest / presentListItem），没有第二套逻辑。
// 与列表唯一的区别：不把时间下界下推进 SQL，这样早于下界的邮件也会出现并显示 out_of_window。
// 唯一的写入是 getOrBuild 回填 mail_index（与列表相同）；不登记设备、不计次数、不写其他表。

export type TestTargets = { addresses: string[] } | { mailIds: number[] };

export type TestOptions = {
  now: number;
  /** 模拟链接 / 授权的创建与首次访问时间；不给时按"刚创建、尚未激活"计算 */
  anchorAt?: number;
  /** 真实主体的锚点（管理员预览链接时用）；给了就忽略 anchorAt */
  anchors?: TimeAnchors;
  limit: number;
};

export type TestResult = { items: RuleGroupTestItem[]; partial: boolean; time_lower_bound: number | null };

/** 试跑结果，外加不进响应体的邮件身份（mail id → 身份），供管理员预览链接时核对取码记录 */
export type TaggedTestResult = { result: TestResult; identities: Map<number, MailIdentity> };

function testLowerBound(compiled: CompiledRuleGroup, options: TestOptions): number | null {
  if (options.anchors !== undefined) return computeTimeLowerBound(compiled.config.time, options.anchors, options.now);
  const anchors =
    options.anchorAt === undefined
      ? { created_at: options.now, first_access_at: null, anchor_reset_at: null }
      : { created_at: options.anchorAt, first_access_at: options.anchorAt, anchor_reset_at: null };
  return computeTimeLowerBound(compiled.config.time, anchors, options.now);
}

type BaseFields = "mail_id" | "received_at" | "recipient" | "parse_status" | "sender" | "subject";

/** 发件人与主题按管理员视角原样给出（展示用 addresses[0]，与呈现层同一口径）；未解析成功的没有 */
function baseItem(item: IndexedItem): Pick<RuleGroupTestItem, BaseFields> {
  const parsed = item.status === "ok" ? item.facts : null;
  return {
    mail_id: item.candidate.id,
    received_at: item.candidate.received_at,
    recipient: item.candidate.recipient,
    parse_status: item.status,
    sender: parsed === null ? null : { address: parsed.sender.addresses[0] ?? null, name: parsed.sender.name || null },
    subject: parsed === null ? null : parsed.subject,
  };
}

function fromEvaluation(item: IndexedItem, evaluation: RuleEvaluation): RuleGroupTestItem {
  return {
    ...baseItem(item),
    visible: evaluation.visible,
    reason_code: evaluation.reason_code,
    reason: evaluation.reason,
    matched: evaluation.matched,
    extracted: evaluation.extracted,
    preview: null,
  };
}

export async function testRuleGroup(
  dbs: MailIndexDbs,
  compiled: CompiledRuleGroup,
  targets: TestTargets,
  options: TestOptions,
): Promise<TestResult> {
  return (await testRuleGroupTagged(dbs, compiled, targets, options)).result;
}

export async function testRuleGroupTagged(
  dbs: MailIndexDbs,
  compiled: CompiledRuleGroup,
  targets: TestTargets,
  options: TestOptions,
): Promise<TaggedTestResult> {
  const lowerBound = testLowerBound(compiled, options);
  const candidates =
    "addresses" in targets
      ? await listCandidates(dbs.MAIL_DB, { addresses: targets.addresses, since: null, beforeId: null, limit: options.limit })
      : await getCandidatesByIds(dbs.MAIL_DB, targets.mailIds);
  const built = await getOrBuild(dbs, candidates);

  const evaluated = built.items.map((item) => {
    if (item.status === "pending") {
      const pending: RuleGroupTestItem = {
        ...baseItem(item),
        visible: false,
        reason_code: "pending",
        reason: "pending",
        matched: [],
        extracted: null,
        preview: null,
      };
      return { item, result: pending };
    }
    return { item, result: fromEvaluation(item, evaluateIndexed(compiled, item, lowerBound)) };
  });

  const visible = evaluated.filter((entry) => entry.result.visible);
  const keep = new Set(
    limitToNewest(
      visible.map((entry) => ({ mail_id: entry.result.mail_id, received_at: entry.result.received_at })),
      compiled.config.limits.max_mails,
    ).map((entry) => entry.mail_id),
  );
  const items = evaluated.map(({ item, result }) => {
    if (!result.visible) return result;
    if (!keep.has(result.mail_id)) return { ...result, visible: false, reason_code: "max_mails", reason: "max_mails" };
    if (item.status !== "ok" || result.extracted === null) throw new Error(`mail ${result.mail_id}: 可见却没有事实或提取结果`);
    return { ...result, preview: presentListItem(compiled.presentation, item.facts, result.extracted) };
  });
  const identities = new Map(built.items.map((item) => [item.candidate.id, mailIdentity(item.candidate)]));
  return { result: { items, partial: built.partial, time_lower_bound: lowerBound }, identities };
}
