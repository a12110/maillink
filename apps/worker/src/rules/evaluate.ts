import type {
  ConditionHit,
  EvaluationReasonCode,
  ExtractedValues,
  MatchedRule,
  PresentConfig,
  RuleEvaluation,
} from "@maillink/shared";
import type { CompiledCond, CompiledRule, CompiledRuleGroup } from "./compile";
import { extractForGroup } from "./extract";
import type { EvaluationInput, MailFacts } from "./facts";
import { isWithinWindow } from "./time";
import { MailView } from "./view";

// 求值（02 §3.2、§3.5、§8）。与规则顺序无关：
//   1. 任一启用的 deny 规则命中 → 不可见
//   2. 正文被截断且规则组需要完整正文 → 不可见（body_truncated）
//   3. blacklist → 可见；whitelist → 命中任一启用的 allow 规则才可见
//   4. code_only 视图下没提取到要显示的内容 → 不可见（no_code）
// 之前先判：解析失败（parse_failed）、早于时间下界（out_of_window）。
// 所有启用规则都会求值，trace 列出全部命中的规则与条件；原因取配置顺序里第一条起决定作用的规则。

export type EvaluationContext = {
  /** computeTimeLowerBound 的结果；null 表示没有下界 */
  time_lower_bound: number | null;
};

type CondResult = { ok: boolean; hits: ConditionHit[] };

export function evaluate(compiled: CompiledRuleGroup, input: EvaluationInput, ctx: EvaluationContext): RuleEvaluation {
  if (input.kind === "failed") {
    return notEvaluated(input.mail_id, input.received_at, "parse_failed");
  }
  const { facts } = input;
  if (!isWithinWindow(facts.received_at, ctx.time_lower_bound)) {
    return notEvaluated(facts.mail_id, facts.received_at, "out_of_window");
  }
  const extracted = extractForGroup(compiled, facts, input.code_source);
  const view = new MailView(facts, extracted);
  const matched = compiled.rules.flatMap((rule) => evaluateRule(rule, view));
  return decide(compiled, facts, extracted, matched);
}

function notEvaluated(mailId: number, receivedAt: number, code: "parse_failed" | "out_of_window"): RuleEvaluation {
  return {
    mail_id: mailId,
    received_at: receivedAt,
    visible: false,
    reason_code: code,
    reason: code,
    reason_rule: null,
    matched: [],
    extracted: null,
  };
}

function decide(
  compiled: CompiledRuleGroup,
  facts: MailFacts,
  extracted: ExtractedValues,
  matched: MatchedRule[],
): RuleEvaluation {
  const result = (visible: boolean, code: EvaluationReasonCode, rule: MatchedRule | null = null): RuleEvaluation => ({
    mail_id: facts.mail_id,
    received_at: facts.received_at,
    visible,
    reason_code: code,
    reason: rule === null ? code : `${rule.effect}:${rule.rule_name}`,
    reason_rule: rule === null ? null : { id: rule.rule_id, name: rule.rule_name },
    matched,
    extracted,
  });
  const deny = matched.find((rule) => rule.effect === "deny");
  if (deny) return result(false, "deny", deny);
  if (facts.body_truncated && compiled.needsFullBody) return result(false, "body_truncated");
  const allow = matched.find((rule) => rule.effect === "allow") ?? null;
  if (compiled.mode === "whitelist" && allow === null) return result(false, "no_allow_match");
  if (!hasPresentableExtraction(compiled.config.present, extracted)) return result(false, "no_code");
  return compiled.mode === "whitelist" ? result(true, "allow_match", allow) : result(true, "blacklist_pass");
}

/** code_only 视图下是否有可显示的提取结果（按 extract）；其他视图恒为 true */
export function hasPresentableExtraction(present: PresentConfig, extracted: ExtractedValues): boolean {
  if (present.view !== "code_only") return true;
  const showsCode = present.extract.includes("code") && extracted.code !== null;
  const showsLink = present.extract.includes("login_link") && extracted.login_link !== null;
  return showsCode || showsLink;
}

function evaluateRule(rule: CompiledRule, view: MailView): MatchedRule[] {
  const { ok, hits } = evaluateCond(rule.cond, view);
  return ok ? [{ rule_id: rule.id, rule_name: rule.name, effect: rule.effect, hits }] : [];
}

function evaluateCond(cond: CompiledCond, view: MailView): CondResult {
  switch (cond.kind) {
    case "leaf": {
      const match = cond.test(view);
      if (match === null) return { ok: false, hits: [] };
      return { ok: true, hits: [{ kind: "leaf", path: cond.path, field: cond.field, op: cond.op, ...match }] };
    }
    case "not": {
      const inner = evaluateCond(cond.child, view);
      return inner.ok ? { ok: false, hits: [] } : { ok: true, hits: [{ kind: "not", path: cond.path }] };
    }
    case "all":
      return evaluateAll(cond.children, view);
    case "any":
      return evaluateAny(cond.children, view);
  }
}

function evaluateAll(children: CompiledCond[], view: MailView): CondResult {
  const hits: ConditionHit[] = [];
  for (const child of children) {
    const result = evaluateCond(child, view);
    if (!result.ok) return { ok: false, hits: [] };
    hits.push(...result.hits);
  }
  return { ok: true, hits };
}

/** any 不短路：trace 里列出所有成立的分支 */
function evaluateAny(children: CompiledCond[], view: MailView): CondResult {
  const results = children.map((child) => evaluateCond(child, view));
  const ok = results.some((result) => result.ok);
  return { ok, hits: ok ? results.flatMap((result) => result.hits) : [] };
}
