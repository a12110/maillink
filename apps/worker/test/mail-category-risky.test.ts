import { builtinRuleGroupTemplates } from "@maillink/shared";
import { describe, expect, it } from "vitest";
import { parseMail } from "../src/mail-parse";
import type { MailCategory } from "../src/mail-parse";
import { evaluate } from "../src/rules/evaluate";
import { buildMail } from "./access-helpers";
import {
  LOGIN_RECHECK,
  LOGIN_SAMPLES,
  RISKY_EXTRA,
  RISKY_FINAL_REVIEW,
  RISKY_RECHECK,
  type CodeMailSample,
} from "./fixtures/risky-code-mails";
import { candidateOf } from "./mail-helpers";
import { compileOrThrow, okInput } from "./rules/helpers";

// 模板 A（06 §3.2，L2：发件人域名 + category = verification）对带验证码的高危邮件与普通登录码邮件的实际判定。
// 每封都跑两遍：内置提取（可能拿不到验证码），以及 temp_email 的 ai_extract 给出验证码（最坏情况：码一定被提取到）。
// 高危邮件两遍都必须不可见，且分类本身就是高危类别——不能靠"恰好没提取到验证码"过关。

const PLATFORM_DOMAIN = "platform.example.org";
const HIGH_RISK: ReadonlySet<MailCategory> = new Set(["email_change", "password_reset", "security_change"]);
const NO_TIME_BOUND = { time_lower_bound: null };

function templateA() {
  const template = builtinRuleGroupTemplates().find((t) => t.key === "resale_shared");
  if (!template) throw new Error("缺少内置模板 resale_shared");
  // 模板里的示例域名换成样本的发件域名，其余原样
  return compileOrThrow(JSON.parse(JSON.stringify(template.config).replaceAll('"openai.com"', JSON.stringify(PLATFORM_DOMAIN))));
}

const aiExtract = (code: string): string => JSON.stringify({ ai_extract: { type: "auth_code", result: code } });

async function judge(sample: CodeMailSample, withAiCode: boolean) {
  const raw = buildMail({ from: `noreply@${PLATFORM_DOMAIN}`, subject: sample.subject, text: sample.text, html: sample.html });
  const parsed = await parseMail({ candidate: candidateOf({ id: 1 }), raw, metadata: withAiCode ? aiExtract(sample.code) : null });
  const result = evaluate(templateA(), okInput(parsed.facts, parsed.code_source), NO_TIME_BOUND);
  return { facts: parsed.facts, result };
}

const cases = (samples: readonly CodeMailSample[]) => samples.map((sample) => [sample.id, sample.lang, sample] as const);

describe("模板 A 拦下带验证码的高危邮件", () => {
  it.each(cases([...RISKY_FINAL_REVIEW, ...RISKY_EXTRA, ...RISKY_RECHECK]))("%s（%s）", async (_id, _lang, sample) => {
    for (const withAiCode of [false, true]) {
      const { facts, result } = await judge(sample, withAiCode);
      expect(HIGH_RISK.has(facts.category), `category=${facts.category} ai=${withAiCode}`).toBe(true);
      expect(result.visible, `reason=${result.reason_code} ai=${withAiCode}`).toBe(false);
    }
    expect((await judge(sample, true)).facts.code).toBe(sample.code);
  });

  it("最终验收的 13 封全部在内（含当时漏判的 #112 / #116 / #123）", () => {
    expect(RISKY_FINAL_REVIEW.map((sample) => sample.id)).toEqual([
      "#110", "#111", "#112", "#113", "#114", "#115", "#116", "#118", "#119", "#120", "#121", "#122", "#123",
    ]);
  });

  it("样本数：最终验收 13 + 补充 33 + 终验复核 10 封高危，登录码 23 + 终验复核 4 封", () => {
    expect([RISKY_FINAL_REVIEW.length, RISKY_EXTRA.length, RISKY_RECHECK.length]).toEqual([13, 33, 10]);
    expect([LOGIN_SAMPLES.length, LOGIN_RECHECK.length]).toEqual([23, 4]);
    expect(RISKY_RECHECK.map((sample) => sample.id)).toEqual(["#130", "#131", "#132", "#133", "#134", "#135", "#136", "#137", "#138", "#139"]);
    expect(LOGIN_RECHECK.map((sample) => sample.id)).toEqual(["#140", "#141", "#142", "#143"]);
  });
});

describe("模板 A 仍显示普通登录码邮件", () => {
  it.each(cases([...LOGIN_SAMPLES, ...LOGIN_RECHECK]))("%s（%s）", async (_id, _lang, sample) => {
    const { facts, result } = await judge(sample, true);
    expect(facts.category).toBe("verification");
    expect(result.visible, `reason=${result.reason_code}`).toBe(true);
    expect(result.extracted?.code).toBe(sample.code);
  });

  it.each(cases([...LOGIN_SAMPLES, ...LOGIN_RECHECK].filter((sample) => sample.builtin)))("%s（%s）：不靠 ai_extract，内置提取也可见", async (_id, _lang, sample) => {
    const { facts, result } = await judge(sample, false);
    expect(facts.code).toBe(sample.code);
    expect(result.visible, `reason=${result.reason_code}`).toBe(true);
  });
});
