import {
  builtinRuleGroupTemplates,
  isValidDomain,
  normalizeDomain,
  PLATFORM_PRESETS,
  validateRuleGroupConfig,
  type RuleGroupConfigInput,
} from "@maillink/shared";
import { describe, expect, it } from "vitest";
import type { CompiledRuleGroup } from "../../src/rules/compile";
import { evaluate } from "../../src/rules/evaluate";
import type { MailFacts } from "../../src/rules/facts";
import { limitToNewest } from "../../src/rules/limit";
import { computeTimeLowerBound } from "../../src/rules/time";
import { presentListItem } from "../../src/render/present";
import { compileOrThrow, leaf, makeConfig, makeFacts, NOW, okInput, rule } from "./helpers";

// 内置模板（02 §9 + 06 §3）、平台预设（06 §4），以及 06 §7 中与规则相关的边界情况。

const templates = builtinRuleGroupTemplates();
const byKey = (key: string): CompiledRuleGroup => {
  const template = templates.find((t) => t.key === key);
  if (!template) throw new Error(`no template ${key}`);
  return compileOrThrow(template.config);
};
const noBound = { time_lower_bound: null };

/** 经 iCloud HME 转发的 OpenAI 登录验证码邮件 */
const openaiLogin = (overrides: Partial<MailFacts> = {}): MailFacts =>
  makeFacts({
    sender: { addresses: ["noreply_at_tm_openai_com@icloud.com", "noreply@tm.openai.com"], domains: ["icloud.com", "tm.openai.com"] },
    ...overrides,
  });

describe("内置模板", () => {
  it("包含 02 §9 的三个与 06 的模板 A / B / C，key 唯一", () => {
    expect(templates.map((t) => t.key)).toEqual([
      "code_only",
      "sender_whitelist",
      "full_access",
      "resale_shared",
      "resale_buyout",
      "resale_login_link",
      "sender_full",
    ]);
  });

  it.each(templates.map((t) => [t.key, t.config] as const))("%s 通过完整的保存校验（含正则试跑）", (key, config) => {
    const result = validateRuleGroupConfig(config);
    expect(result.errors).toEqual([]);
    const expectedWarnings = key === "sender_whitelist" ? ["whitelist_no_enabled_allow"] : [];
    expect(result.warnings.map((w) => w.code)).toEqual(expectedWarnings);
  });

  it("每次返回新的深拷贝", () => {
    const first = builtinRuleGroupTemplates();
    (first[0]?.config as RuleGroupConfigInput).present.view = "full";
    expect(builtinRuleGroupTemplates()[0]?.config.present.view).toBe("code_only");
  });

  it("模板 A 与 06 §3.2 的 JSON 一致（外加 schema_version）", () => {
    expect(templates.find((t) => t.key === "resale_shared")?.config).toEqual({
      schema_version: 1,
      time: { window_minutes: 15, since: { type: "first_access", lookback_minutes: 5 } },
      filter: {
        mode: "whitelist",
        rules: [
          {
            id: "allow-login",
            name: "本平台的验证码",
            enabled: true,
            effect: "allow",
            when: {
              all: [
                { field: "sender.domain", op: "domain_is", value: ["openai.com"] },
                { field: "category", op: "eq", value: "verification" },
              ],
            },
          },
          { id: "deny-custom", name: "自定义屏蔽词", enabled: true, effect: "deny", when: { field: "content", op: "contains", value: ["更换邮箱", "change your email"] } },
        ],
      },
      present: { view: "code_only", extract: ["code"], sender: "name", recipient: "full", snippet: false, links: "strip", remote_images: "block", attachments: "hidden", redact: [] },
      limits: { max_mails: 3 },
    });
  });

  it("指定发件人模板：默认什么都不显示，填好域名并启用后才放行", () => {
    const template = builtinRuleGroupTemplates().find((t) => t.key === "sender_whitelist");
    if (!template) throw new Error("missing");
    expect(evaluate(compileOrThrow(template.config), okInput(openaiLogin()), noBound).reason_code).toBe("no_allow_match");
    const filled = template.config.filter.rules.map((r) => ({ ...r, enabled: true, when: leaf("sender.domain", "domain_is", ["openai.com"]) }));
    const config = { ...template.config, filter: { ...template.config.filter, rules: filled } };
    expect(evaluate(compileOrThrow(config), okInput(openaiLogin()), noBound).visible).toBe(true);
  });

  it("指定发件人（完整显示）：openai.com / chatgpt.com（含子域名）放行且为 full 视图，其他域名不放行", () => {
    const compiled = byKey("sender_full");
    const from = (domain: string) => makeFacts({ sender: { addresses: [`noreply@${domain}`], domains: [domain] } });
    for (const domain of ["openai.com", "email.openai.com", "chatgpt.com"]) {
      expect(evaluate(compiled, okInput(from(domain)), noBound).visible, domain).toBe(true);
    }
    expect(compiled.config.present.view).toBe("full");
    for (const domain of ["fakeopenai.com", "openai.com.evil.io", "example.com"]) {
      const result = evaluate(compiled, okInput(from(domain)), noBound);
      expect(result.visible, domain).toBe(false);
      expect(result.reason_code, domain).toBe("no_allow_match");
    }
  });

  it("完整访问模板：黑名单、无规则、full 视图", () => {
    const result = evaluate(byKey("full_access"), okInput(makeFacts({ code: null, category: "billing" })), noBound);
    expect(result.reason_code).toBe("blacklist_pass");
  });
});

describe("平台预设（06 §4）", () => {
  it("9 个平台，key 唯一，域名合法且未经真实邮件核对", () => {
    expect(PLATFORM_PRESETS.map((p) => p.name)).toEqual([
      "OpenAI",
      "Anthropic",
      "Google",
      "Apple",
      "Microsoft",
      "Netflix",
      "Steam",
      "Discord",
      "Spotify",
    ]);
    expect(new Set(PLATFORM_PRESETS.map((p) => p.key)).size).toBe(PLATFORM_PRESETS.length);
    for (const preset of PLATFORM_PRESETS) {
      expect(preset.verified).toBe(false);
      expect(preset.subject_patterns).toEqual([]);
      expect(preset.code_regex).toBeNull();
      for (const domain of preset.sender_domains) expect(isValidDomain(normalizeDomain(domain)), domain).toBe(true);
    }
  });

  it.each(PLATFORM_PRESETS.map((p) => [p.name, p] as const))("%s 预设生成的 L2 规则组通过校验", (_name, preset) => {
    const allow = rule("allow", "allow", {
      all: [leaf("sender.domain", "domain_is", [...preset.sender_domains]), leaf("category", "eq", "verification")],
    });
    const config = makeConfig({ mode: "whitelist", rules: [allow], present: { view: "code_only", links: "strip" } });
    expect(validateRuleGroupConfig(config).errors).toEqual([]);
  });
});

describe("06 §7 边界情况（规则相关）", () => {
  const shared = () => byKey("resale_shared");

  it("经 iCloud 转发的本平台登录验证码：可见，只给验证码", () => {
    const facts = openaiLogin({ code: "123 456" });
    const result = evaluate(shared(), okInput(facts, "builtin"), noBound);
    expect(result.visible).toBe(true);
    expect(presentListItem(shared().presentation, facts, result.extracted!)).toEqual({
      id: 1,
      received_at: facts.received_at,
      sender: { name: "OpenAI" },
      recipient: "alias123@icloud.com",
      code: "123456",
    });
  });

  it("重设密码发的也是 6 位码：分类为 password_reset → 模板 A 不显示；仅验证码模板按分类屏蔽", () => {
    const facts = openaiLogin({ subject: "Your verification code", body: "Use 123456 to reset", category: "password_reset" });
    expect(evaluate(shared(), okInput(facts), noBound).reason_code).toBe("no_allow_match");
    expect(evaluate(byKey("code_only"), okInput(facts), noBound).reason).toBe("deny:屏蔽高危分类");
  });

  it("关键词表没覆盖、被判成 verification 的改密邮件：仅验证码模板的关键词规则兜住", () => {
    const facts = openaiLogin({ subject: "Password reset", body: "Your password reset code is 123456" });
    expect(evaluate(byKey("code_only"), okInput(facts), noBound).reason).toBe("deny:屏蔽改密与安全通知");
  });

  it("更换邮箱类邮件：自定义屏蔽词命中", () => {
    const facts = openaiLogin({ body: "Confirm to change your email. Code 123456" });
    expect(evaluate(shared(), okInput(facts), noBound).reason).toBe("deny:自定义屏蔽词");
  });

  it("平台换了发件域名：未命中 allow（后台预览能看到原因）", () => {
    const facts = makeFacts({ sender: { addresses: ["noreply@openai-mail.net"], domains: ["openai-mail.net"] } });
    expect(evaluate(shared(), okInput(facts), noBound).reason_code).toBe("no_allow_match");
  });

  it("同一个别名注册了多个平台：OpenAI 的规则组看不到 Netflix 的邮件", () => {
    const facts = makeFacts({ sender: { addresses: ["info@account.netflix.com"], domains: ["account.netflix.com"] } });
    expect(evaluate(shared(), okInput(facts), noBound).reason_code).toBe("no_allow_match");
  });

  it("分类为 verification 但没提取到验证码：code_only 下不显示（no_code）", () => {
    const facts = openaiLogin({ code: null });
    expect(evaluate(shared(), okInput(facts), noBound).reason_code).toBe("no_code");
  });

  it("买家先点发送、后开链接：lookback 5 分钟内的可见，更早的不可见", () => {
    const template = templates.find((t) => t.key === "resale_shared");
    const config = validateRuleGroupConfig(template?.config);
    if (!config.ok) throw new Error("invalid");
    const bound = computeTimeLowerBound(config.config.time, { created_at: NOW - 86_400 * 30, first_access_at: NOW, anchor_reset_at: null }, NOW);
    const at = (receivedAt: number) => evaluate(shared(), okInput(openaiLogin({ received_at: receivedAt })), { time_lower_bound: bound });
    expect(at(NOW - 4 * 60).visible).toBe(true);
    expect(at(NOW - 6 * 60).reason_code).toBe("out_of_window");
    expect(at(NOW - 86_400).reason_code).toBe("out_of_window");
  });

  it("售后换号并重置起始时间：看不到重置之前的邮件", () => {
    const template = templates.find((t) => t.key === "resale_buyout");
    const config = validateRuleGroupConfig(template?.config);
    if (!config.ok) throw new Error("invalid");
    const reset = NOW - 600;
    const bound = computeTimeLowerBound(config.config.time, { created_at: NOW - 86_400, first_access_at: NOW - 3_600, anchor_reset_at: reset }, NOW);
    expect(bound).toBe(reset - 10 * 60);
    const before = evaluate(byKey("resale_buyout"), okInput(openaiLogin({ received_at: reset - 11 * 60 })), { time_lower_bound: bound });
    expect(before.reason_code).toBe("out_of_window");
  });

  it("连点几次重新发送：max_mails=3 只保留最新 3 封", () => {
    const compiled = shared();
    const visible = [1, 2, 3, 4, 5]
      .map((id) => evaluate(compiled, okInput(openaiLogin({ mail_id: id, received_at: NOW - 100 + id })), noBound))
      .filter((r) => r.visible);
    expect(limitToNewest(visible, compiled.config.limits.max_mails).map((r) => r.mail_id)).toEqual([5, 4, 3]);
  });

  it("模板 B（买断）：只限发件人域名、屏蔽账单、保留链接", () => {
    const buyout = byKey("resale_buyout");
    expect(evaluate(buyout, okInput(openaiLogin({ category: "email_change", code: null })), noBound).visible).toBe(true);
    expect(evaluate(buyout, okInput(openaiLogin({ category: "billing" })), noBound).reason).toBe("deny:屏蔽账单");
    expect(buyout.config.present.links).toBe("keep");
  });

  it("模板 B（买断）：付款方式变更（分类为 security_change）按关键词屏蔽，其他安全变更通知照常显示", () => {
    const buyout = byKey("resale_buyout");
    const security = (subject: string, body: string) => openaiLogin({ subject, body, category: "security_change" });
    const payment = [
      security("Your verification code", "Your verification code is 138138. Use this code to update your payment method."),
      security("Payment method updated", "A new card ending in 4242 was added to your account."),
      security("Billing information changed", "We updated the billing information on your account."),
      security("安全提醒", "您的账号付款方式已变更。"),
    ];
    for (const facts of payment) expect(evaluate(buyout, okInput(facts), noBound).reason).toBe("deny:屏蔽付款方式通知");
    const others = [
      security("Security alert", "Two-factor authentication has been disabled for your account."),
      security("Your verification code", "Your verification code is 132132. Enter it to verify your new phone number."),
      security("Account recovery", "Use this code to recover your account: 123456"),
    ];
    for (const facts of others) expect(evaluate(buyout, okInput(facts), noBound)).toMatchObject({ visible: true, reason: "allow:本平台发件人" });
  });

  it("模板 C：只提取本平台域名的登录链接", () => {
    const loginLink = byKey("resale_login_link");
    const facts = openaiLogin({ code: null, links: ["https://evil.example/x", "https://auth.openai.com/magic?t=abc"] });
    const result = evaluate(loginLink, okInput(facts), noBound);
    expect(result.visible).toBe(true);
    expect(presentListItem(loginLink.presentation, facts, result.extracted!).login_link).toBe("https://auth.openai.com/magic?t=abc");
    const phishing = openaiLogin({ code: null, links: ["https://openai.com.evil.io/magic"] });
    expect(evaluate(loginLink, okInput(phishing), noBound).reason_code).toBe("no_code");
  });
});
