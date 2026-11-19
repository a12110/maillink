import type { Cond, PresentConfig, Rule, RuleGroupConfigInput } from "@maillink/shared";
import { compileRuleGroup, type CompiledRuleGroup } from "../../src/rules/compile";
import type { CodeSource, EvaluationInput, MailFacts } from "../../src/rules/facts";

// 规则引擎测试的公共构造器。

export const NOW = 1_800_000_000;

type FactsOverrides = Omit<Partial<MailFacts>, "sender"> & { sender?: Partial<MailFacts["sender"]> };

export function makeFacts(overrides: FactsOverrides = {}): MailFacts {
  const { sender, ...rest } = overrides;
  return {
    mail_id: 1,
    received_at: NOW - 60,
    recipient: "alias123@icloud.com",
    sender: {
      addresses: ["noreply@tm.openai.com"],
      domains: ["tm.openai.com"],
      name: "OpenAI",
      envelope: "bounce@mail.openai.com",
      ...sender,
    },
    subject: "Your ChatGPT code is 123456",
    body: "Enter this temporary verification code to continue: 123456",
    body_truncated: false,
    links: [],
    link_domains: [],
    attachments: [],
    code: "123456",
    category: "verification",
    raw_size: 4096,
    has_html: true,
    ...rest,
  };
}

export const PRESENT_TEXT: PresentConfig = {
  view: "text",
  sender: "full",
  recipient: "full",
  snippet: true,
  links: "keep",
  remote_images: "block",
  attachments: "list",
  redact: [],
  extract: ["code"],
};

export function rule(id: string, effect: "allow" | "deny", when: Cond, enabled = true): Rule {
  return { id, name: `规则${id}`, enabled, effect, when };
}

type ConfigOverrides = {
  mode?: "whitelist" | "blacklist";
  rules?: Rule[];
  present?: Partial<RuleGroupConfigInput["present"]>;
  time?: RuleGroupConfigInput["time"];
  limits?: RuleGroupConfigInput["limits"];
};

export function makeConfig(overrides: ConfigOverrides = {}): RuleGroupConfigInput {
  return {
    schema_version: 1,
    time: overrides.time ?? { since: { type: "none" } },
    filter: { mode: overrides.mode ?? "blacklist", rules: overrides.rules ?? [] },
    present: { ...PRESENT_TEXT, ...overrides.present },
    limits: overrides.limits ?? {},
  };
}

export function compileOrThrow(config: unknown): CompiledRuleGroup {
  const result = compileRuleGroup(config);
  if (!result.ok) throw new Error(`compile failed: ${JSON.stringify(result.error.issues)}`);
  return result.compiled;
}

export function okInput(facts: MailFacts, codeSource: CodeSource | null = facts.code === null ? null : "builtin"): EvaluationInput {
  return { kind: "ok", facts, code_source: codeSource };
}

/** 故意放宽参数类型：测试里要构造字段、操作符不合法的条件 */
export const leaf = (field: string, op: unknown, value: unknown, caseSensitive?: boolean): Cond =>
  ({ field, op, value, ...(caseSensitive === undefined ? {} : { case_sensitive: caseSensitive }) }) as Cond;
