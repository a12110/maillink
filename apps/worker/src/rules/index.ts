// 规则引擎（纯函数，无 IO）。见 docs/design/02-rule-engine.md。
export type { CodeSource, EvaluationInput, MailCategory, MailFacts } from "./facts";
export {
  compileRuleGroup,
  needsFullBody,
  type CompiledPresentation,
  type CompiledRedaction,
  type CompiledRule,
  type CompiledRuleGroup,
  type CompileResult,
  type RuleGroupCompileError,
} from "./compile";
export { evaluate, hasPresentableExtraction, type EvaluationContext } from "./evaluate";
export { cleanCode, extractForGroup, extractLoginLink, extractWithRegex } from "./extract";
export { computeTimeLowerBound, isWithinWindow, type TimeAnchors } from "./time";
export { limitToNewest, type NewestOrdered } from "./limit";
export { draftRuleFromMail, type RuleDraft } from "./draft";
export { compileDomainList, matchDomain, parseHttpUrl, toAsciiDomain, urlHost } from "./domains";
