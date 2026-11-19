import {
  BODY_FIELDS,
  compileUserRegex,
  escapeRegExp,
  formatIssuePath,
  normalizeText,
  validateRuleGroupConfig,
  type Cond,
  type PresentConfig,
  type Redaction,
  type Rule,
  type RuleGroupConfig,
  type RuleGroupIssue,
  type RuleOp,
} from "@maillink/shared";
import { compileDomainList } from "./domains";
import { compileLeaf, type CompiledLeaf } from "./operators";

// 规则组编译：先走与保存时相同的校验（不试跑计时），通过后预编译正则、归一化比较值。
// 不合 schema、版本不认识、正则编译失败都返回明确错误，调用方据此让该规则组下的邮件全部不可见（02 §5 失败关闭）。

export type CompiledCond =
  | { kind: "all" | "any"; path: string; children: CompiledCond[] }
  | { kind: "not"; path: string; child: CompiledCond }
  | CompiledLeaf;

export type CompiledRule = { id: string; name: string; effect: "allow" | "deny"; cond: CompiledCond };

export type CompiledRedaction = { name: string; regex: RegExp; subject: boolean; body: boolean; replace: string };

/** 呈现层需要的预编译结果（render 使用） */
export type CompiledPresentation = {
  config: PresentConfig;
  /** links = { allow_domains } 时的域名匹配集合；keep / strip 时为 null */
  allowDomains: string[] | null;
  redactions: CompiledRedaction[];
};

export type CompiledRuleGroup = {
  config: RuleGroupConfig;
  mode: "whitelist" | "blacklist";
  /** 只含启用的规则，保持配置顺序 */
  rules: CompiledRule[];
  /** 正文被截断时是否无法完整判定（02 §3.5，见 needsFullBody） */
  needsFullBody: boolean;
  codeRegex: RegExp | null;
  extractLoginLink: boolean;
  presentation: CompiledPresentation;
};

export type RuleGroupCompileError = {
  code: "rule_group_unsupported_version" | "rule_group_invalid";
  message: string;
  issues: RuleGroupIssue[];
};

export type CompileResult = { ok: true; compiled: CompiledRuleGroup } | { ok: false; error: RuleGroupCompileError };

export function compileRuleGroup(raw: unknown): CompileResult {
  const validation = validateRuleGroupConfig(raw, { regexProbe: "skip" });
  if (!validation.ok) {
    const unsupported = validation.errors.some((issue) => issue.code === "unsupported_schema_version");
    return {
      ok: false,
      error: {
        code: unsupported ? "rule_group_unsupported_version" : "rule_group_invalid",
        message: unsupported ? "规则组版本不认识" : "规则组配置不合法",
        issues: validation.errors,
      },
    };
  }
  return { ok: true, compiled: build(validation.config) };
}

function build(config: RuleGroupConfig): CompiledRuleGroup {
  const enabled = config.filter.rules.filter((rule) => rule.enabled);
  const present = config.present;
  return {
    config,
    mode: config.filter.mode,
    rules: enabled.map(compileRule),
    needsFullBody: needsFullBody(enabled, present.redact.length),
    codeRegex:
      present.code_regex === undefined ? null : compileUserRegex(present.code_regex, { caseSensitive: false, global: false }),
    extractLoginLink: present.extract.includes("login_link"),
    presentation: {
      config: present,
      allowDomains: typeof present.links === "object" ? compileDomainList(present.links.allow_domains) : null,
      redactions: present.redact.map(compileRedaction),
    },
  };
}

function compileRule(rule: Rule): CompiledRule {
  return { id: rule.id, name: rule.name, effect: rule.effect, cond: compileCond(rule.when, ["when"]) };
}

function compileCond(cond: Cond, path: Array<string | number>): CompiledCond {
  const text = formatIssuePath(path);
  if ("not" in cond) return { kind: "not", path: text, child: compileCond(cond.not, [...path, "not"]) };
  if ("all" in cond) {
    return { kind: "all", path: text, children: cond.all.map((c, i) => compileCond(c, [...path, "all", i])) };
  }
  if ("any" in cond) {
    return { kind: "any", path: text, children: cond.any.map((c, i) => compileCond(c, [...path, "any", i])) };
  }
  return compileLeaf(cond, text);
}

function compileRedaction(redaction: Redaction): CompiledRedaction {
  const pattern =
    redaction.match.type === "regex"
      ? redaction.match.pattern
      : // 文本脱敏：按字面匹配，模式里的空格可以匹配任意空白（展示文本保留了换行）
        escapeRegExp(normalizeText(redaction.match.pattern)).replace(/ /gu, "\\s+");
  return {
    name: redaction.name,
    regex: compileUserRegex(pattern, { caseSensitive: false, global: true }),
    subject: redaction.scope.includes("subject"),
    body: redaction.scope.includes("body"),
    replace: redaction.replace,
  };
}

/** 截断后仍"只可能少命中"的操作符：正文截断保留前缀，contains / starts_with 在截断文本上为真则在全文上也为真 */
const PREFIX_MONOTONE_OPS: ReadonlySet<RuleOp> = new Set<RuleOp>(["contains", "starts_with"]);

/**
 * 正文被截断时，这个规则组能否仍然可靠判定（02 §3.5）。需要完整正文的情形：
 *   - 有脱敏规则（截断部分无法保证脱敏）；
 *   - 任一启用的 deny 规则用到 body / content（设计文档原文）；
 *   - 补充：任一启用的 allow 规则在否定（奇数层 not）下用到 body / content，或用了 eq / ends_with / regex
 *     这类在截断文本上可能"多命中"的操作符——它们会让截断邮件比完整判定更容易可见。
 */
export function needsFullBody(enabledRules: readonly Rule[], redactionCount: number): boolean {
  if (redactionCount > 0) return true;
  return enabledRules.some((rule) => bodyLeafUnsafe(rule.when, rule.effect, 0));
}

function bodyLeafUnsafe(cond: Cond, effect: "allow" | "deny", negations: number): boolean {
  if ("not" in cond) return bodyLeafUnsafe(cond.not, effect, negations + 1);
  if ("all" in cond) return cond.all.some((child) => bodyLeafUnsafe(child, effect, negations));
  if ("any" in cond) return cond.any.some((child) => bodyLeafUnsafe(child, effect, negations));
  if (!BODY_FIELDS.includes(cond.field)) return false;
  if (effect === "deny") return true;
  return negations % 2 === 1 || !PREFIX_MONOTONE_OPS.has(cond.op);
}
