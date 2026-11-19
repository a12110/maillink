import {
  EXTRACTED_CODE_MAX_LENGTH,
  normalizeText,
  type CodeStep,
  type ExtractedValues,
} from "@maillink/shared";
import type { CompiledRuleGroup } from "./compile";
import { matchDomain, parseHttpUrl, urlHost } from "./domains";
import type { CodeSource, MailFacts } from "./facts";

// 规则组级提取（02 §4.6）。
// 验证码严格优先级：
//   1. facts.code 来自 ai_extract → 直接用；
//   2. 否则规则组配了 code_regex → 先主题后正文提取，提取到就用；
//   3. 否则用 facts.code（此时来源为内置提取或为空）。
// 输出统一去掉空格与连字符。某一步得到的值不像验证码（去分隔符后不是 1–16 位 ASCII 字母数字）时视为该步无效、
// 继续下一步，并记进 code_steps：防止 code_only 视图借"验证码"把整段正文带出去（例如 code_regex 写成 `验证码(.*)`）。
// 登录链接：extract 含 login_link 时，取 facts.links 中第一个域名落在 links.allow_domains 内的 http(s) 链接。

const CODE_SEPARATORS = /[\s\-\u2010-\u2015]/gu;
const VALID_CODE = /^[A-Za-z0-9]+$/u;

/** 去掉空格与连字符；不像验证码时返回 null */
export function cleanCode(raw: string): string | null {
  const code = normalizeText(raw).replace(CODE_SEPARATORS, "");
  if (code.length === 0 || code.length > EXTRACTED_CODE_MAX_LENGTH || !VALID_CODE.test(code)) return null;
  return code;
}

/** facts.code 与 code_source 必须一致；不一致是上游数据契约错误，直接抛出 */
export function assertCodeSource(facts: MailFacts, codeSource: CodeSource | null): void {
  if ((facts.code === null) !== (codeSource === null)) {
    throw new Error(
      `mail ${facts.mail_id}: code_source=${String(codeSource)} 与 facts.code（${facts.code === null ? "空" : "非空"}）不一致`,
    );
  }
}

export function extractForGroup(
  compiled: CompiledRuleGroup,
  facts: MailFacts,
  codeSource: CodeSource | null,
): ExtractedValues {
  assertCodeSource(facts, codeSource);
  const code = extractCode(compiled.codeRegex, facts, codeSource);
  const loginLink = compiled.extractLoginLink ? extractLoginLink(compiled.presentation.allowDomains, facts.links) : null;
  return { ...code, login_link: loginLink };
}

type CodeResult = Pick<ExtractedValues, "code" | "code_origin" | "code_steps">;

// code_steps 每一步的结果：used 采用；skipped 前面已得到结果；no_match 没提取到；
// invalid 得到的值不像验证码；not_applicable 这一步不适用（没有 ai_extract 结果 / 没配 code_regex / facts.code 不是内置结果）
function extractCode(codeRegex: RegExp | null, facts: MailFacts, codeSource: CodeSource | null): CodeResult {
  const steps: CodeStep[] = [];
  if (codeSource === "ai_extract") {
    const code = cleanCode(facts.code ?? "");
    steps.push({ step: "ai_extract", result: code === null ? "invalid" : "used" });
    if (code !== null) {
      steps.push({ step: "code_regex", result: codeRegex === null ? "not_applicable" : "skipped" });
      steps.push({ step: "builtin", result: "skipped" });
      return { code, code_origin: "ai_extract", code_steps: steps };
    }
  } else {
    steps.push({ step: "ai_extract", result: "not_applicable" });
  }
  if (codeRegex === null) {
    steps.push({ step: "code_regex", result: "not_applicable" });
  } else {
    const fromRegex = extractWithRegex(codeRegex, facts);
    steps.push({ step: "code_regex", result: fromRegex.result });
    if (fromRegex.code !== null) {
      steps.push({ step: "builtin", result: "skipped" });
      return { code: fromRegex.code, code_origin: "code_regex", code_steps: steps };
    }
  }
  return builtinStep(facts, codeSource, steps);
}

function builtinStep(facts: MailFacts, codeSource: CodeSource | null, steps: CodeStep[]): CodeResult {
  if (codeSource !== "builtin") {
    // null：M2 什么也没提取到；ai_extract：facts.code 是（无效的）AI 结果，不是内置结果
    steps.push({ step: "builtin", result: codeSource === null ? "no_match" : "not_applicable" });
    return { code: null, code_origin: null, code_steps: steps };
  }
  const code = cleanCode(facts.code ?? "");
  steps.push({ step: "builtin", result: code === null ? "invalid" : "used" });
  return { code, code_origin: code === null ? null : "builtin", code_steps: steps };
}

/** 先主题后正文；有捕获组取第 1 组，否则取整个匹配。主题里匹配到但结果无效时继续试正文 */
export function extractWithRegex(
  regex: RegExp,
  facts: Pick<MailFacts, "subject" | "body">,
): { result: "used" | "no_match" | "invalid"; code: string | null } {
  let sawInvalid = false;
  for (const text of [facts.subject, facts.body]) {
    const match = regex.exec(normalizeText(text));
    if (match === null) continue;
    const code = cleanCode(match.length > 1 ? (match[1] ?? "") : match[0]);
    if (code !== null) return { result: "used", code };
    sawInvalid = true;
  }
  return { result: sawInvalid ? "invalid" : "no_match", code: null };
}

export function extractLoginLink(allowDomains: readonly string[] | null, links: readonly string[]): string | null {
  if (allowDomains === null || allowDomains.length === 0) return null;
  for (const link of links) {
    const url = parseHttpUrl(link);
    if (url !== null && matchDomain(urlHost(url), allowDomains) !== null) return url.href;
  }
  return null;
}
