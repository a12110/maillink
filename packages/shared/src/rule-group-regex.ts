import {
  CLOCK_CALIBRATION_MAX_ROUNDS,
  CLOCK_CALIBRATION_TEXT_CHARS,
  REGEX_PROBE_LENGTHS,
  REGEX_PROBE_MAX_RUN_MS,
  REGEX_PROBE_TERMINATOR,
  REGEX_PROBE_UNITS,
} from "./rule-group-limits";
import { normalizeText } from "./rule-group-normalize";
import { CHARSET_ANY, CHARSET_BITS, charCategory, classCharset, escapeCharset } from "./rule-group-regex-charset";

// 管理员写的正则：编译、静态检查、试跑计时（02 §7）。
//
// 为什么需要两道检查：Cloudflare Workers 线上环境为防 Spectre，纯计算期间 performance.now() / Date.now() 不前进
// （只在 I/O 之后更新；本地 workerd 与浏览器不受此限）。所以后端保存时的计时试跑在线上测不出耗时。
// 因此：
//   1. 静态检查（确定性，任何环境都生效）：拒绝反向引用、带重复的分组里含分支 / 可变重复 / 带量词子组（`(a+)+`、`(a|b)+`、`(\w*){20}`）、
//      未锚定且以无上限重复开头并带后续内容的模式（`.*x`、`\w+@`，在 32 KB 正文上是平方级）、
//      同一序列里字符集可能重叠的无上限重复：紧挨着的两个（`\d+\d+`）或中间只隔可省略原子的三个及以上
//      （`x\w*\w*\w*!`、`x\w*\s*\w*\s*\w*!`，立方级）。只隔可省略原子的两个（`\s*[:：]?\s*`）放行，靠试跑与长度上限兜底。
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

export type RegexStaticIssue = "backreference" | "nested_quantifier" | "leading_unbounded" | "adjacent_unbounded";

type Leading = "none" | "pending" | "confirmed";
/** 原子匹配的长度范围与字符集（零宽断言不产生 Span） */
type Span = { chars: number; min: number; max: number };
type Atom = {
  group: boolean;
  innerComplex: boolean;
  innerLeading: Leading;
  first: boolean;
  /** 字符集（组为组内并集）；0 表示零宽断言 */
  chars: number;
  /** 不带量词的组里只有一个非零宽原子时，它的 Span（组透明，参与相邻判断） */
  single: Span | null;
  /** 组内没有任何非零宽原子（含环视） */
  zeroWidth: boolean;
  quantifier: Quantifier | null;
};
/** 当前序列里"只隔可省略原子"的无上限重复：每类字符各有几个，以及紧挨着的上一个的字符集 */
type Run = { counts: number[]; last: number };
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
  lookaround: boolean;
  alternation: boolean;
  chars: number;
  spans: number;
  onlySpan: Span | null;
  run: Run;
};
type Quantifier = { min: number; max: number; length: number };

const newRun = (): Run => ({ counts: CHARSET_BITS.map(() => 0), last: 0 });
const newFrame = (lookaround = false): Frame => ({
  complex: false,
  branchAtoms: 0,
  branchAnchored: false,
  pending: false,
  leadingUnbounded: false,
  last: null,
  lookaround,
  alternation: false,
  chars: 0,
  spans: 0,
  onlySpan: null,
  run: newRun(),
});
const plainAtom = (chars: number): Atom => ({
  group: false,
  innerComplex: false,
  innerLeading: "none",
  first: false,
  chars,
  single: null,
  zeroWidth: chars === 0,
  quantifier: null,
});

/** 只能对已能成功编译（u 模式）的模式调用 */
export function analyzeRegexPattern(pattern: string): RegexStaticIssue[] {
  const issues = new Set<RegexStaticIssue>();
  const stack: Frame[] = [newFrame()];
  let index = 0;
  while (index < pattern.length) {
    index = step(pattern, index, stack, issues);
  }
  const root = stack[0] as Frame;
  finishAtom(root, issues);
  if (stack[0]?.leadingUnbounded === true) issues.add("leading_unbounded");
  return [...issues];
}

function step(p: string, i: number, stack: Frame[], issues: Set<RegexStaticIssue>): number {
  const ch = p[i];
  const frame = stack[stack.length - 1] as Frame;
  switch (ch) {
    case "\\":
      return readEscape(p, i, frame, issues);
    case "[": {
      const end = skipClass(p, i);
      pushAtom(frame, plainAtom(classCharset(p.slice(i + 1, end - 1))), issues);
      return end;
    }
    case "(":
      stack.push(newFrame(isLookaround(p, i)));
      return skipGroupPrefix(p, i);
    case ")":
      closeGroup(stack, issues);
      return i + 1;
    case "|":
      finishAtom(frame, issues);
      Object.assign(frame, { branchAtoms: 0, branchAnchored: false, pending: false, last: null, complex: true });
      Object.assign(frame, { alternation: true, run: newRun() });
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
  pushAtom(frame, plainAtom(p[i] === "." ? CHARSET_ANY : charCategory(p[i] ?? "")), issues);
  return i + 1;
}

function isLookaround(p: string, i: number): boolean {
  if (p[i + 1] !== "?") return false;
  const kind = p[i + 2];
  return kind === "=" || kind === "!" || (kind === "<" && (p[i + 3] === "=" || p[i + 3] === "!"));
}

function readEscape(p: string, i: number, frame: Frame, issues: Set<RegexStaticIssue>): number {
  const next = p[i + 1] ?? "";
  const named = next === "k" && p[i + 2] === "<";
  if (/[1-9]/u.test(next) || named) issues.add("backreference");
  pushAtom(frame, plainAtom(named ? CHARSET_ANY : escapeCharset(next)), issues);
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

function closeGroup(stack: Frame[], issues: Set<RegexStaticIssue>): void {
  if (stack.length < 2) return;
  const inner = stack.pop() as Frame;
  finishAtom(inner, issues);
  const parent = stack[stack.length - 1] as Frame;
  parent.complex ||= inner.complex;
  const innerLeading: Leading = inner.leadingUnbounded ? "confirmed" : inner.pending ? "pending" : "none";
  pushAtom(
    parent,
    {
      group: true,
      innerComplex: inner.complex,
      innerLeading,
      first: false,
      chars: inner.chars,
      single: !inner.alternation && inner.spans === 1 ? inner.onlySpan : null,
      zeroWidth: inner.lookaround || inner.spans === 0,
      quantifier: null,
    },
    issues,
  );
}

function pushAtom(frame: Frame, atom: Atom, issues: Set<RegexStaticIssue>): void {
  finishAtom(frame, issues);
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

function atomSpan(atom: Atom): Span | null {
  if (atom.zeroWidth) return null;
  const q = atom.quantifier;
  const base: Span = atom.single ?? { chars: atom.chars, min: 1, max: 1 };
  if (q === null) return base;
  return { chars: atom.chars, min: q.min === 0 ? 0 : base.min, max: q.max === Infinity ? Infinity : base.max };
}

/**
 * 原子的量词确定后（下一个原子到来、分支或组结束时）登记进当前序列：
 * 无上限的重复按字符类计数；可省略的定长原子不打断序列；必选的定长原子开始新序列。
 */
function finishAtom(frame: Frame, issues: Set<RegexStaticIssue>): void {
  const atom = frame.last;
  if (atom === null) return;
  const span = atomSpan(atom);
  if (span === null) return;
  frame.chars |= span.chars;
  frame.spans += 1;
  frame.onlySpan = frame.spans === 1 ? span : null;
  const run = frame.run;
  if (span.max !== Infinity) {
    if (span.min === 0) run.last = 0;
    else frame.run = newRun();
    return;
  }
  if ((run.last & span.chars) !== 0) issues.add("adjacent_unbounded");
  CHARSET_BITS.forEach((bit, index) => {
    if ((span.chars & bit) === 0) return;
    run.counts[index] = (run.counts[index] ?? 0) + 1;
    if ((run.counts[index] ?? 0) >= OVERLAPPING_UNBOUNDED_MAX) issues.add("adjacent_unbounded");
  });
  run.last = span.chars;
}

/** 同一序列里同类字符的无上限重复达到这个数就拒绝（三个即立方级） */
const OVERLAPPING_UNBOUNDED_MAX = 3;

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
  atom.quantifier = q;
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
