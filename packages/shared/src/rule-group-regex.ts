import {
  CLOCK_CALIBRATION_MAX_ROUNDS,
  CLOCK_CALIBRATION_TEXT_CHARS,
  REGEX_PROBE_LENGTHS,
  REGEX_PROBE_MAX_RUN_MS,
  REGEX_PROBE_TERMINATOR,
  REGEX_PROBE_UNITS,
} from "./rule-group-limits";
import { normalizeText } from "./rule-group-normalize";

// 管理员写的正则：编译、静态检查、试跑计时（02 §7）。
//
// 为什么需要两道检查：Cloudflare Workers 线上环境为防 Spectre，纯计算期间 performance.now() / Date.now() 不前进
// （只在 I/O 之后更新；本地 workerd 与浏览器不受此限）。所以后端保存时的计时试跑在线上测不出耗时。
// 因此：
//   1. 静态检查（确定性，任何环境都生效）：拒绝反向引用、带重复的分组里含分支 / 可变重复 / 带量词子组（`(a+)+`、`(a|b)+`、`(\w*){20}`）、
//      未锚定且以无上限重复开头并带后续内容的模式（`.*x`、`\w+@`，在 32 KB 正文上是平方级）。
//   2. 试跑计时：在固定样本上跑，单次超过阈值即拒绝。先做时钟自检，时钟不前进时给出警告而不是假装测过。
//      编辑器（浏览器）里同一函数能真实计时，保存前就把问题拦下。

export type Clock = () => number;

/** 用户正则统一的编译方式：归一化模式串（与被匹配文本同一套归一化），u 标志；默认不区分大小写 */
export function compileUserRegex(pattern: string, options: { caseSensitive: boolean; global: boolean }): RegExp {
  const flags = `${options.global ? "g" : ""}${options.caseSensitive ? "" : "i"}u`;
  return new RegExp(normalizeText(pattern), flags);
}

/** 转义为 u 模式下合法的字面量正则（u 模式不允许 `\-` 这类多余转义） */
export function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|/]/gu, "\\$&");
}

// ---- 静态检查 ----

export type RegexStaticIssue = "backreference" | "nested_quantifier" | "leading_unbounded";

type Leading = "none" | "pending" | "confirmed";
type Atom = { group: boolean; innerComplex: boolean; innerLeading: Leading; first: boolean };
type Frame = {
  /** 本组（含子组）出现过分支 |、可变长度的重复（min≠max，含 ?）或带量词的子组 */
  complex: boolean;
  branchAtoms: number;
  branchAnchored: boolean;
  /** 当前分支以无上限重复开头，等待后续原子确认 */
  pending: boolean;
  /** 已确认：某分支以无上限重复开头且后面还有内容 */
  leadingUnbounded: boolean;
  last: Atom | null;
};
type Quantifier = { min: number; max: number; length: number };

const newFrame = (): Frame => ({
  complex: false,
  branchAtoms: 0,
  branchAnchored: false,
  pending: false,
  leadingUnbounded: false,
  last: null,
});
const plainAtom = (): Atom => ({ group: false, innerComplex: false, innerLeading: "none", first: false });

/** 只能对已能成功编译（u 模式）的模式调用 */
export function analyzeRegexPattern(pattern: string): RegexStaticIssue[] {
  const issues = new Set<RegexStaticIssue>();
  const stack: Frame[] = [newFrame()];
  let index = 0;
  while (index < pattern.length) {
    index = step(pattern, index, stack, issues);
  }
  if (stack[0]?.leadingUnbounded === true) issues.add("leading_unbounded");
  return [...issues];
}

function step(p: string, i: number, stack: Frame[], issues: Set<RegexStaticIssue>): number {
  const ch = p[i];
  const frame = stack[stack.length - 1] as Frame;
  switch (ch) {
    case "\\":
      return readEscape(p, i, frame, issues);
    case "[":
      pushAtom(frame, plainAtom());
      return skipClass(p, i);
    case "(":
      stack.push(newFrame());
      return skipGroupPrefix(p, i);
    case ")":
      closeGroup(stack);
      return i + 1;
    case "|":
      Object.assign(frame, { branchAtoms: 0, branchAnchored: false, pending: false, last: null, complex: true });
      return i + 1;
    case "^":
      if (frame.branchAtoms === 0) frame.branchAnchored = true;
      return i + 1;
    case "$":
      return i + 1;
    default:
      return readAtomOrQuantifier(p, i, frame, issues);
  }
}

function readAtomOrQuantifier(p: string, i: number, frame: Frame, issues: Set<RegexStaticIssue>): number {
  const quantifier = readQuantifier(p, i);
  if (quantifier) {
    applyQuantifier(frame, quantifier, issues);
    return i + quantifier.length;
  }
  pushAtom(frame, plainAtom());
  return i + 1;
}

function readEscape(p: string, i: number, frame: Frame, issues: Set<RegexStaticIssue>): number {
  const next = p[i + 1] ?? "";
  const named = next === "k" && p[i + 2] === "<";
  if (/[1-9]/u.test(next) || named) issues.add("backreference");
  pushAtom(frame, plainAtom());
  return escapeEnd(p, i, next, named);
}

/** 转义序列之后的位置：\u{...} \p{...} \k<name> 到闭合符号；\uXXXX \xHH \cX 定长；其余两个字符 */
function escapeEnd(p: string, i: number, next: string, named: boolean): number {
  const braced = (next === "u" || next === "p" || next === "P") && p[i + 2] === "{";
  if (braced) return p.indexOf("}", i) + 1;
  if (named) return p.indexOf(">", i) + 1;
  const fixedLengths: Record<string, number> = { u: 6, x: 4, c: 3 };
  return i + (fixedLengths[next] ?? 2);
}

function skipClass(p: string, i: number): number {
  let j = i + 1;
  if (p[j] === "^") j += 1;
  while (j < p.length) {
    if (p[j] === "\\") j += 2;
    else if (p[j] === "]") return j + 1;
    else j += 1;
  }
  return j;
}

function skipGroupPrefix(p: string, i: number): number {
  if (p[i + 1] !== "?") return i + 1;
  const kind = p[i + 2];
  if (kind === ":" || kind === "=" || kind === "!") return i + 3;
  if (kind === "<") {
    const lookbehind = p[i + 3] === "=" || p[i + 3] === "!";
    return lookbehind ? i + 4 : p.indexOf(">", i) + 1;
  }
  // 修饰符组 (?i:...) / (?-i:...)
  return p.indexOf(":", i) + 1;
}

function closeGroup(stack: Frame[]): void {
  if (stack.length < 2) return;
  const inner = stack.pop() as Frame;
  const parent = stack[stack.length - 1] as Frame;
  parent.complex ||= inner.complex;
  const innerLeading: Leading = inner.leadingUnbounded ? "confirmed" : inner.pending ? "pending" : "none";
  pushAtom(parent, { group: true, innerComplex: inner.complex, innerLeading, first: false });
}

function pushAtom(frame: Frame, atom: Atom): void {
  if (frame.pending) {
    frame.leadingUnbounded = true;
    frame.pending = false;
  }
  const first = frame.branchAtoms === 0 && !frame.branchAnchored;
  if (first && atom.innerLeading === "confirmed") frame.leadingUnbounded = true;
  if (first && atom.innerLeading === "pending") frame.pending = true;
  frame.branchAtoms += 1;
  frame.last = { ...atom, first };
}

const BRACE_QUANTIFIER = /^\{(\d+)(,(\d*))?\}/u;

function readQuantifier(p: string, i: number): Quantifier | null {
  const simple: Record<string, [number, number]> = { "*": [0, Infinity], "+": [1, Infinity], "?": [0, 1] };
  const ch = p[i] ?? "";
  let result: Quantifier | null = null;
  const bounds = simple[ch];
  if (bounds) {
    result = { min: bounds[0], max: bounds[1], length: 1 };
  } else if (ch === "{") {
    const match = BRACE_QUANTIFIER.exec(p.slice(i));
    if (!match) return null;
    const min = Number(match[1]);
    const max = match[2] === undefined ? min : match[3] === "" ? Infinity : Number(match[3]);
    result = { min, max, length: match[0].length };
  }
  if (result && p[i + result.length] === "?") result.length += 1;
  return result;
}

/**
 * 带重复（max ≥ 2，含固定 {n}）的分组，组内只要有分支 |、可变长度重复或带量词的子组就拒绝：
 * 每次重复都有多种走法，失败时回溯数随重复次数指数增长（`a(\w|\d)+!`、`x(\w*\s*){20}!`、`(a?){20}a{20}`）。
 * 不带量词的分支组（如 `(?:code|码)`）与组内只有定长重复的（如 `(\d{3})+`）不受影响。
 */
function applyQuantifier(frame: Frame, q: Quantifier, issues: Set<RegexStaticIssue>): void {
  const atom = frame.last;
  if (!atom) return;
  if (q.max !== q.min || atom.group) frame.complex = true;
  if (atom.group && q.max >= 2 && atom.innerComplex) issues.add("nested_quantifier");
  if (q.max === Infinity && atom.first) frame.pending = true;
}

// ---- 试跑计时 ----

export type RegexProbeOutcome = { ok: true } | { ok: false; unit: string; length: number; ms: number };

const sampleCache = new Map<string, string>();

function probeSample(unit: string, length: number): string {
  const key = `${unit}\u0000${length}`;
  let sample = sampleCache.get(key);
  if (sample === undefined) {
    sample = unit.repeat(Math.ceil(length / unit.length)).slice(0, length) + REGEX_PROBE_TERMINATOR;
    sampleCache.set(key, sample);
  }
  return sample;
}

/**
 * 在固定样本上试跑：用全局版本做 replace（覆盖"找到第一个即停"与"扫完全文"两种用法），
 * 样本长度递增，单次超过 REGEX_PROBE_MAX_RUN_MS 立即停止并拒绝。
 */
export function probeRegexCost(regex: RegExp, clock: Clock): RegexProbeOutcome {
  const scanner = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  for (const unit of REGEX_PROBE_UNITS) {
    for (const length of REGEX_PROBE_LENGTHS) {
      const sample = probeSample(unit, length);
      const start = clock();
      sample.replace(scanner, "");
      const ms = clock() - start;
      if (ms > REGEX_PROBE_MAX_RUN_MS) return { ok: false, unit, length, ms };
    }
  }
  return { ok: true };
}

/** 默认时钟：performance.now()（亚毫秒、单调），没有时退回 Date.now() */
export function defaultClock(): Clock {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf ? () => perf.now() : () => Date.now();
}

/** 时钟自检：做有限的固定工作，时钟始终不变说明当前环境计算期间时钟冻结（Workers 线上） */
export function clockAdvances(clock: Clock): boolean {
  const text = "a1 ".repeat(CLOCK_CALIBRATION_TEXT_CHARS / 2).slice(0, CLOCK_CALIBRATION_TEXT_CHARS);
  const digits = /\d/gu;
  const start = clock();
  for (let round = 0; round < CLOCK_CALIBRATION_MAX_ROUNDS; round += 1) {
    text.replace(digits, "");
    if (clock() !== start) return true;
  }
  return false;
}
