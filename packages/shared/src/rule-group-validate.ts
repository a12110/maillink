import { ruleGroupConfigSchema, type PresentConfig, type RuleGroupConfig, type TimeConfig } from "./rule-group";
import {
  ruleGroupError,
  ruleGroupWarning,
  type RuleGroupIssue,
  type RuleGroupIssuePath,
} from "./rule-group-issues";
import { REGEX_PROBE_MAX_RUN_MS, RULE_GROUP_LIMITS, RULE_GROUP_SCHEMA_VERSION } from "./rule-group-limits";
import { normalizeText } from "./rule-group-normalize";
import {
  analyzeRegexPattern,
  clockAdvances,
  compileUserRegex,
  defaultClock,
  probeRegexCost,
  type Clock,
  type RegexProbeOutcome,
  type RegexStaticIssue,
} from "./rule-group-regex";
import { checkDomainItem, checkFilter, type RegexCandidate, type ValidationContext } from "./rule-group-validate-cond";
import { mapZodIssues } from "./rule-group-validate-zod";

// 规则组保存校验（纯函数，前端编辑器与后端保存、编译共用）。
// 结构错误（zod）先报；结构正确才做语义校验。错误阻止保存，警告只提示。

export type RuleGroupValidation =
  | { ok: true; config: RuleGroupConfig; errors: []; warnings: RuleGroupIssue[] }
  | { ok: false; config: null; errors: RuleGroupIssue[]; warnings: RuleGroupIssue[] };

export type ValidateRuleGroupOptions = {
  /** 是否试跑正则计时。保存时用 'run'（默认）；运行时编译用 'skip'，避免每个请求都试跑 */
  regexProbe?: "run" | "skip";
  /** 计时用的时钟，默认 performance.now()；测试可注入 */
  clock?: Clock;
};

export function validateRuleGroupConfig(input: unknown, options: ValidateRuleGroupOptions = {}): RuleGroupValidation {
  const early = checkVersion(input) ?? checkRawDepth(input);
  if (early) return { ok: false, config: null, errors: [early], warnings: [] };
  const parsed = ruleGroupConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, config: null, errors: mapZodIssues(parsed.error.issues, input), warnings: [] };
  }
  const ctx: ValidationContext = { issues: [], regexes: [] };
  checkTime(parsed.data.time, ctx);
  checkFilter(parsed.data, ctx);
  checkPresent(parsed.data.present, ctx);
  checkRegexes(ctx, options);
  const errors = ctx.issues.filter((issue) => issue.severity === "error");
  const warnings = ctx.issues.filter((issue) => issue.severity === "warning");
  if (errors.length > 0) return { ok: false, config: null, errors, warnings };
  return { ok: true, config: parsed.data, errors: [], warnings };
}

function checkVersion(input: unknown): RuleGroupIssue | null {
  if (typeof input !== "object" || input === null) return null;
  const version = (input as { schema_version?: unknown }).schema_version;
  if (typeof version !== "number" || version === RULE_GROUP_SCHEMA_VERSION) return null;
  return ruleGroupError(
    "unsupported_schema_version",
    ["schema_version"],
    `不认识的规则组版本 ${version}（当前支持 ${RULE_GROUP_SCHEMA_VERSION}）`,
  );
}

/** 迭代（非递归）地量原始输入的嵌套深度，超深直接拒绝，保护后面的递归解析 */
function checkRawDepth(input: unknown): RuleGroupIssue | null {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }];
  while (stack.length > 0) {
    const { value, depth } = stack.pop() as { value: unknown; depth: number };
    if (typeof value !== "object" || value === null) continue;
    if (depth > RULE_GROUP_LIMITS.rawDepthGuard) {
      return ruleGroupError("cond_too_deep", [], `配置的嵌套层级超过 ${RULE_GROUP_LIMITS.rawDepthGuard}，拒绝解析`);
    }
    for (const child of Object.values(value)) stack.push({ value: child, depth: depth + 1 });
  }
  return null;
}

function checkTime(time: TimeConfig, ctx: ValidationContext): void {
  const { since } = time;
  const sincePath: RuleGroupIssuePath = ["time", "since"];
  if (since.type === "fixed" && since.at === undefined) {
    ctx.issues.push(ruleGroupError("fixed_since_requires_at", [...sincePath, "at"], "起始方式为固定时间时必须填写 at（Unix 秒）"));
  }
  if (since.type !== "fixed" && since.at !== undefined) {
    ctx.issues.push(ruleGroupWarning("since_at_ignored", [...sincePath, "at"], "at 只在起始方式为固定时间时生效，当前会被忽略"));
  }
  const hasAnchor = since.type === "subject_created" || since.type === "first_access";
  if (!hasAnchor && (since.lookback_minutes ?? 0) > 0) {
    ctx.issues.push(
      ruleGroupWarning(
        "lookback_ignored",
        [...sincePath, "lookback_minutes"],
        "lookback_minutes 只对\"链接创建时间\"与\"首次访问时间\"两种起始方式生效，当前会被忽略",
      ),
    );
  }
}

function checkPresent(present: PresentConfig, ctx: ValidationContext): void {
  checkViewConstraints(present, ctx);
  if (typeof present.links === "object") {
    const domains = present.links.allow_domains;
    const path: RuleGroupIssuePath = ["present", "links", "allow_domains"];
    if (domains.length > RULE_GROUP_LIMITS.maxAllowDomains) {
      ctx.issues.push(
        ruleGroupError("value_list_too_long", path, `允许的链接域名 ${domains.length} 个，超过上限 ${RULE_GROUP_LIMITS.maxAllowDomains}`),
      );
    }
    domains.forEach((domain, index) => checkDomainItem(domain, [...path, index], ctx));
  }
  checkRedactions(present, ctx);
  if (present.code_regex !== undefined) {
    const path: RuleGroupIssuePath = ["present", "code_regex"];
    if (normalizeText(present.code_regex) === "") {
      ctx.issues.push(ruleGroupError("empty_value", path, "code_regex 不能为空；不需要时删掉该字段"));
    } else {
      ctx.regexes.push({ pattern: present.code_regex, path, caseSensitive: false, global: false });
    }
  }
}

function checkViewConstraints(present: PresentConfig, ctx: ValidationContext): void {
  const viewPath: RuleGroupIssuePath = ["present", "view"];
  const extractPath: RuleGroupIssuePath = ["present", "extract"];
  if (present.view === "full" && present.redact.length > 0) {
    ctx.issues.push(
      ruleGroupError(
        "full_view_with_redaction",
        viewPath,
        "配置了脱敏规则时不能用完整 HTML 视图：HTML 里的文字可能被标签切开（如 12<b>34</b>），在 HTML 上做文本替换不可靠。请改用纯文本或更严格的视图",
      ),
    );
  }
  if (present.view === "full" && present.links !== "keep") {
    ctx.issues.push(
      ruleGroupError(
        "full_view_with_link_filter",
        viewPath,
        "隐藏或限制链接（links 不是 keep）时不能用完整 HTML 视图：HTML 里的链接可以藏在属性、样式和文字里，无法保证处理干净。请改用纯文本或更严格的视图",
      ),
    );
  }
  const links = present.links;
  const hasAllowDomains = typeof links === "object" && links.allow_domains.length > 0;
  if (present.extract.includes("login_link") && !hasAllowDomains) {
    ctx.issues.push(
      ruleGroupError(
        "login_link_requires_allow_domains",
        extractPath,
        "提取登录链接要求 links 是非空的 { allow_domains: [...] }：登录链接只从这些域名的链接里取。登录链接等同一次完整登录，只给确实不发验证码的平台用",
      ),
    );
  }
  if (present.view === "code_only" && present.extract.length === 0) {
    ctx.issues.push(
      ruleGroupError("code_only_requires_extract", extractPath, "仅验证码视图需要在 extract 里至少选择验证码或登录链接之一"),
    );
  }
}

function checkRedactions(present: PresentConfig, ctx: ValidationContext): void {
  const base: RuleGroupIssuePath = ["present", "redact"];
  if (present.redact.length > RULE_GROUP_LIMITS.maxRedactions) {
    ctx.issues.push(
      ruleGroupError("too_many_redactions", base, `脱敏规则 ${present.redact.length} 条，超过上限 ${RULE_GROUP_LIMITS.maxRedactions}`),
    );
  }
  present.redact.forEach((redaction, index) => {
    const path: RuleGroupIssuePath = [...base, index, "match", "pattern"];
    if (normalizeText(redaction.match.pattern) === "") {
      ctx.issues.push(ruleGroupError("empty_value", path, "脱敏的匹配内容不能为空"));
      return;
    }
    if (redaction.match.type === "regex") {
      ctx.regexes.push({ pattern: redaction.match.pattern, path, caseSensitive: false, global: true });
    }
  });
}

const STATIC_ISSUE_MESSAGES: Record<RegexStaticIssue, [RuleGroupIssue["code"], string]> = {
  backreference: ["regex_backreference", "不支持反向引用（\\1、\\k<name>）：可能导致指数级回溯"],
  nested_quantifier: [
    "regex_nested_quantifier",
    "带重复的分组（+、*、{n} 等）里不能再有分支 |、可变长度的重复（含 ?）或带量词的子分组（如 (a+)+、(\\w|\\d)+、(\\w*\\s*){20}），否则可能灾难性回溯；请改写成单层重复或字符类（如 [\\w\\d]+）",
  ],
  adjacent_unbounded: [
    "regex_adjacent_unbounded",
    "同一处有多个字符可能重叠的无上限重复（如 \\d+\\d+、\\w*\\s*\\w*\\s*\\w*），在长正文上是多项式级回溯；请合并成一个重复（如 \\w+），或给重复加上上限（如 \\w{1,20}）",
  ],
  leading_unbounded: [
    "regex_leading_unbounded",
    "正则以无上限的重复开头（如 .*x、\\w+@），在长正文上是平方级耗时。regex 本来就是\"包含\"匹配，去掉开头的 .* 即可，或用 ^ 锚定开头",
  ],
};

function checkRegexes(ctx: ValidationContext, options: ValidateRuleGroupOptions): void {
  if (ctx.regexes.length > RULE_GROUP_LIMITS.maxRegexPatterns) {
    ctx.issues.push(
      ruleGroupError("too_many_regex", [], `正则共 ${ctx.regexes.length} 个，超过上限 ${RULE_GROUP_LIMITS.maxRegexPatterns}`),
    );
    return;
  }
  const probeable: Array<{ candidate: RegexCandidate; regex: RegExp }> = [];
  for (const candidate of ctx.regexes) {
    const regex = compileCandidate(candidate, ctx);
    if (regex) probeable.push({ candidate, regex });
  }
  if ((options.regexProbe ?? "run") === "skip" || probeable.length === 0) return;
  probeRegexes(probeable, options.clock ?? defaultClock(), ctx);
}

/** 长度、编译、静态检查；全部通过才返回编译结果 */
function compileCandidate(candidate: RegexCandidate, ctx: ValidationContext): RegExp | null {
  const normalized = normalizeText(candidate.pattern);
  const length = [...normalized].length;
  if (length > RULE_GROUP_LIMITS.maxRegexLength) {
    ctx.issues.push(
      ruleGroupError("regex_too_long", candidate.path, `正则长度 ${length} 超过上限 ${RULE_GROUP_LIMITS.maxRegexLength} 个字符`),
    );
    return null;
  }
  let regex: RegExp;
  try {
    regex = compileUserRegex(candidate.pattern, candidate);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    ctx.issues.push(ruleGroupError("regex_invalid", candidate.path, `正则无法编译：${reason}`));
    return null;
  }
  const staticIssues = analyzeRegexPattern(normalized);
  for (const issue of staticIssues) {
    const [code, message] = STATIC_ISSUE_MESSAGES[issue];
    ctx.issues.push(ruleGroupError(code, candidate.path, message));
  }
  return staticIssues.length === 0 ? regex : null;
}

function probeRegexes(items: Array<{ candidate: RegexCandidate; regex: RegExp }>, clock: Clock, ctx: ValidationContext): void {
  if (!clockAdvances(clock)) {
    ctx.issues.push(
      ruleGroupWarning(
        "regex_probe_unavailable",
        [],
        "当前运行环境在纯计算期间时钟不前进（如 Cloudflare Workers 线上），无法试跑计时；已完成长度、编译与静态检查",
      ),
    );
    return;
  }
  const outcomes = new Map<string, RegexProbeOutcome>();
  for (const { candidate, regex } of items) {
    const key = `${regex.flags}\u0000${regex.source}`;
    const outcome = outcomes.get(key) ?? probeRegexCost(regex, clock);
    outcomes.set(key, outcome);
    if (outcome.ok) continue;
    ctx.issues.push(
      ruleGroupError(
        "regex_too_slow",
        candidate.path,
        `在 ${outcome.length} 个字符的样本（由"${outcome.unit}"重复组成）上试跑耗时 ${outcome.ms.toFixed(1)} ms，超过 ${REGEX_PROBE_MAX_RUN_MS} ms 上限，可能存在灾难性回溯`,
      ),
    );
  }
}
