import {
  RULE_GROUP_SCHEMA_VERSION,
  type RuleEvaluation,
  type RuleGroupConfigInput,
} from "@maillink/shared";
import { ApiError } from "../errors";
import { HTTP_SERVICE_UNAVAILABLE } from "../http-status";
import type { IndexedItem } from "../mail-index";
import { compileRuleGroup, computeTimeLowerBound, evaluate, type CompiledRuleGroup, type TimeAnchors } from "../rules";

// 访问作用域与求值策略（02 §5）。链接、用户授权、管理员都先构造 AccessScope，再交给同一条流水线。

/**
 * 一个主体能看到的范围。
 * - addresses：收件地址（mailboxes.address，导入时写法）；
 * - policy：编译好的规则组；null 表示管理员（全量可见、完整呈现、没有时间下界）；
 * - anchors：时间下界的锚点（链接或授权的创建、首次访问、重置时间）。
 */
export type AccessScope = {
  addresses: string[];
  policy: CompiledRuleGroup | null;
  anchors: TimeAnchors;
};

/** 求值时实际使用的规则组与时间下界 */
export type EffectivePolicy = { compiled: CompiledRuleGroup; lowerBound: number | null };

/**
 * 完整访问：黑名单、无规则、full 视图（02 §5"授权的 rule_group_id 为空"，也是管理员的呈现方式）。
 * 其余呈现项取最宽松但仍安全的值：远程图片默认阻止（防追踪像素），附件可下载。
 */
export function fullAccessRuleGroupConfig(): RuleGroupConfigInput {
  return {
    schema_version: RULE_GROUP_SCHEMA_VERSION,
    time: { since: { type: "none" } },
    filter: { mode: "blacklist", rules: [] },
    present: {
      view: "full",
      sender: "full",
      recipient: "full",
      snippet: true,
      links: "keep",
      remote_images: "block",
      attachments: "download",
      redact: [],
      extract: ["code"],
    },
    limits: {},
  };
}

/**
 * 编译规则组；不合 schema、版本不认识、正则编译失败都抛明确错误码，
 * 调用方据此让整个作用域不可见（02 §5 失败关闭表），不做任何降级。
 */
export function compilePolicy(config: unknown): CompiledRuleGroup {
  const result = compileRuleGroup(config);
  if (!result.ok) {
    throw new ApiError(HTTP_SERVICE_UNAVAILABLE, result.error.code, `${result.error.message}，相关邮件暂不可见`);
  }
  return result.compiled;
}

/** 库里存的配置文本 → 编译结果；JSON 本身损坏同样按"规则组配置不合法"失败关闭 */
export function compileStoredPolicy(configText: string): CompiledRuleGroup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(configText);
  } catch {
    throw new ApiError(HTTP_SERVICE_UNAVAILABLE, "rule_group_invalid", "规则组配置不是合法的 JSON，相关邮件暂不可见");
  }
  return compilePolicy(parsed);
}

/** 用户授权的策略：rule_group_id 为空时是完整访问（02 §5），否则编译该规则组的配置 */
export function grantPolicy(ruleGroupConfigText: string | null): CompiledRuleGroup {
  return ruleGroupConfigText === null ? compilePolicy(fullAccessRuleGroupConfig()) : compileStoredPolicy(ruleGroupConfigText);
}

let adminPolicy: CompiledRuleGroup | null = null;

/** 管理员的呈现策略（与完整访问相同的编译结果，按 isolate 缓存） */
export function adminCompiledPolicy(): CompiledRuleGroup {
  adminPolicy ??= compilePolicy(fullAccessRuleGroupConfig());
  return adminPolicy;
}

export function effectivePolicy(scope: AccessScope, now: number): EffectivePolicy {
  if (scope.policy === null) return { compiled: adminCompiledPolicy(), lowerBound: null };
  return { compiled: scope.policy, lowerBound: computeTimeLowerBound(scope.policy.config.time, scope.anchors, now) };
}

/** 已就绪（ok / failed）的索引项求值；failed 判为 parse_failed，不可见 */
export function evaluateIndexed(
  compiled: CompiledRuleGroup,
  item: Exclude<IndexedItem, { status: "pending" }>,
  lowerBound: number | null,
): RuleEvaluation {
  const ctx = { time_lower_bound: lowerBound };
  if (item.status === "failed") {
    return evaluate(compiled, { kind: "failed", mail_id: item.candidate.id, received_at: item.candidate.received_at }, ctx);
  }
  return evaluate(compiled, { kind: "ok", facts: item.facts, code_source: item.code_source }, ctx);
}
