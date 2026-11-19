import {
  compileUserRegex,
  normalizeText,
  RULE_FIELD_KINDS,
  type CondLeaf,
  type CondValue,
  type RuleField,
  type RuleFieldKind,
  type RuleOp,
} from "@maillink/shared";
import { compileDomainList, matchDomain } from "./domains";
import type { BoolField, MailView, TextField } from "./view";

// 叶子条件的预编译：取值归一化（与字段值同一套）、正则预编译、域名转成匹配集合（02 §3.4）。

export type LeafMatch = { value: string; candidate?: string };
export type LeafTest = (view: MailView) => LeafMatch | null;

export type CompiledLeaf = {
  kind: "leaf";
  path: string;
  field: RuleField;
  op: RuleOp;
  test: LeafTest;
};

type PlainTextOp = "eq" | "contains" | "starts_with" | "ends_with";

const TEXT_MATCHERS: Record<PlainTextOp, (candidate: string, value: string) => boolean> = {
  eq: (c, v) => c === v,
  contains: (c, v) => c.includes(v),
  starts_with: (c, v) => c.startsWith(v),
  ends_with: (c, v) => c.endsWith(v),
};

export function compileLeaf(leaf: CondLeaf, path: string): CompiledLeaf {
  return { kind: "leaf", path, field: leaf.field, op: leaf.op, test: buildTest(leaf, RULE_FIELD_KINDS[leaf.field]) };
}

function buildTest(leaf: CondLeaf, kind: RuleFieldKind): LeafTest {
  switch (leaf.op) {
    case "is":
      return boolTest(leaf.field as BoolField, asBoolean(leaf.value));
    case "gt":
    case "lt":
      return numberTest(leaf.op, asNumber(leaf.value));
    case "domain_is":
      return domainTest(leaf.field as TextField, asStringList(leaf.value));
    case "regex":
      return regexTest(leaf, kind);
    default:
      return kind === "enum" ? categoryTest(asStringList(leaf.value)) : textTest(leaf, leaf.op, kind);
  }
}

/** 列表字段在 trace 里回显命中的元素；正文类标量字段不回显内容 */
const withCandidate = (kind: RuleFieldKind, value: string, candidate: string): LeafMatch =>
  kind === "text" ? { value } : { value, candidate };

function textTest(leaf: CondLeaf, op: PlainTextOp, kind: RuleFieldKind): LeafTest {
  const caseSensitive = leaf.case_sensitive === true;
  const display = asStringList(leaf.value).map(normalizeText);
  const values = caseSensitive ? display : display.map((v) => v.toLowerCase());
  const matcher = TEXT_MATCHERS[op];
  const field = leaf.field as TextField;
  return (view) => {
    for (const candidate of view.texts(field, caseSensitive)) {
      const index = values.findIndex((value) => matcher(candidate, value));
      if (index >= 0) return withCandidate(kind, display[index] as string, candidate);
    }
    return null;
  };
}

function regexTest(leaf: CondLeaf, kind: RuleFieldKind): LeafTest {
  const caseSensitive = leaf.case_sensitive === true;
  const patterns = asStringList(leaf.value);
  const regexes = patterns.map((pattern) => compileUserRegex(pattern, { caseSensitive, global: false }));
  const field = leaf.field as TextField;
  return (view) => {
    for (const candidate of view.texts(field, true)) {
      const index = regexes.findIndex((regex) => regex.test(candidate));
      if (index >= 0) return withCandidate(kind, patterns[index] as string, candidate);
    }
    return null;
  };
}

function domainTest(field: TextField, values: string[]): LeafTest {
  const compiled = compileDomainList(values);
  return (view) => {
    for (const candidate of view.texts(field, false)) {
      const matched = matchDomain(candidate, compiled);
      if (matched !== null) return { value: matched, candidate };
    }
    return null;
  };
}

function categoryTest(values: string[]): LeafTest {
  const allowed = new Set(values.map(normalizeText));
  return (view) => {
    const category = view.category();
    return allowed.has(category) ? { value: category } : null;
  };
}

function boolTest(field: BoolField, expected: boolean): LeafTest {
  return (view) => (view.bool(field) === expected ? { value: String(expected) } : null);
}

function numberTest(op: "gt" | "lt", limit: number): LeafTest {
  return (view) => {
    const size = view.size();
    const hit = op === "gt" ? size > limit : size < limit;
    return hit ? { value: String(limit), candidate: String(size) } : null;
  };
}

// 编译只接收已通过校验的配置；类型对不上说明调用方绕过了校验，直接抛错（失败关闭）
function asStringList(value: CondValue): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value;
  throw new TypeError(`条件取值应为文本或文本数组，实际是 ${typeof value}`);
}

function asBoolean(value: CondValue): boolean {
  if (typeof value !== "boolean") throw new TypeError(`条件取值应为布尔值，实际是 ${typeof value}`);
  return value;
}

function asNumber(value: CondValue): number {
  if (typeof value !== "number") throw new TypeError(`条件取值应为数字，实际是 ${typeof value}`);
  return value;
}
