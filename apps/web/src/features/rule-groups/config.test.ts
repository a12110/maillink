import { describe, expect, it } from "vitest";
import { builtinRuleGroupTemplates, validateRuleGroupConfig } from "@maillink/shared";
import type { Cond, CondLeaf, Rule, RuleGroupConfig } from "@maillink/shared";
import type { RuleDraft } from "../../api/rule-draft";
import {
  asFormConfig,
  BLANK_CONFIG,
  buildWhen,
  canExtractLoginLink,
  changeLeafField,
  changeLeafOp,
  configFromDraft,
  countChanges,
  flattenWhen,
  fullViewBlockers,
  itemsToValue,
  newLeaf,
  newRule,
  templateChoices,
  templateConfig,
  valueItems,
} from "./config";
import { parseJsonConfig, prettyJson } from "./editor/editor-state";

const leaf = (field: CondLeaf["field"], op: CondLeaf["op"], value: CondLeaf["value"]): CondLeaf => ({ field, op, value });

function templateByKey(key: string): RuleGroupConfig {
  const found = templateConfig(key);
  if (!found) throw new Error(`没有模板 ${key}`);
  return found.config;
}

describe("配置 ↔ 表单：模板与 JSON 往返", () => {
  it("「指定发件人（完整显示）」在模板列表末尾，选中后表单预填正确", () => {
    const choices = templateChoices();
    expect(choices[choices.length - 1]).toMatchObject({ key: "sender_full", name: "指定发件人（完整显示）" });
    const found = templateConfig("sender_full");
    expect(found?.name).toBe("指定发件人（完整显示）");
    expect(found?.config.filter).toEqual({
      mode: "whitelist",
      rules: [
        {
          id: "allow-sender",
          name: "允许的发件人",
          enabled: true,
          effect: "allow",
          when: { field: "sender.domain", op: "domain_is", value: ["openai.com", "chatgpt.com"] },
        },
      ],
    });
    expect(found?.config.time).toEqual({ since: { type: "subject_created", lookback_minutes: 0 } });
    expect(found?.config.present.view).toBe("full");
    expect(found?.config.present.links).toBe("keep");
    expect(found?.config.present.attachments).toBe("download");
  });

  it("7 个内置模板都能进表单模式，且通过保存校验（无错误）", () => {
    const templates = builtinRuleGroupTemplates();
    expect(templates).toHaveLength(7);
    for (const template of templates) {
      const form = asFormConfig(template.config);
      expect(form, template.key).not.toBeNull();
      const result = validateRuleGroupConfig(template.config, { regexProbe: "skip" });
      expect(result.errors, template.key).toEqual([]);
    }
  });

  it("配置 → JSON 文本 → 配置：每个模板往返后完全相同，不丢字段", () => {
    for (const template of builtinRuleGroupTemplates()) {
      const form = asFormConfig(template.config);
      const parsed = parseJsonConfig(prettyJson(form));
      expect(parsed.ok, template.key).toBe(true);
      if (parsed.ok) expect(asFormConfig(parsed.value), template.key).toEqual(form);
    }
  });

  it("表单改动后经 JSON 往返仍相同（窗口、锚点、规则、脱敏、链接域名、正则、上限都在）", () => {
    const base = templateByKey("resale_login_link");
    const edited: RuleGroupConfig = {
      ...base,
      time: { window_minutes: 45, since: { type: "fixed", at: 1_700_000_000, lookback_minutes: 3 } },
      filter: { mode: "whitelist", rules: [...base.filter.rules, newRule(base.filter.rules, "deny")] },
      present: {
        ...base.present,
        view: "text",
        links: { allow_domains: ["a.example.com", "b.example.com"] },
        redact: [{ name: "手机号", match: { type: "regex", pattern: "1[3-9]\\d{9}" }, scope: ["subject", "body"], replace: "***" }],
        code_regex: "验证码[:：]\\s*(\\d{6})",
      },
      limits: { max_mails: 7 },
    };
    const parsed = parseJsonConfig(prettyJson(edited));
    expect(parsed.ok && asFormConfig(parsed.value)).toEqual(edited);
  });

  it("含 not / 多层嵌套的规则：表单不能展开（flatten 为 null），但配置原样保留，改别的规则不动它", () => {
    const nested: Cond = { not: { all: [leaf("subject", "contains", "x")] } };
    const rule: Rule = { id: "n", name: "嵌套", enabled: true, effect: "deny", when: nested };
    const config: RuleGroupConfig = { ...BLANK_CONFIG, filter: { mode: "whitelist", rules: [rule, newRule([rule], "allow")] } };
    const form = asFormConfig(JSON.parse(JSON.stringify(config)));
    expect(form?.filter.rules[0]?.when).toEqual(nested);
    expect(flattenWhen(nested)).toBeNull();
    expect(flattenWhen({ all: [{ any: [leaf("subject", "contains", "x")] }] })).toBeNull();
    const renamed = { ...form, filter: { ...form?.filter, rules: form?.filter.rules.map((r, i) => (i === 1 ? { ...r, name: "改名" } : r)) } };
    expect(JSON.parse(JSON.stringify(renamed)).filter.rules[0].when).toEqual(nested);
  });

  it("结构不合法（拼错字段、不是对象）不能进表单模式：返回 null，不静默忽略", () => {
    expect(asFormConfig({ ...BLANK_CONFIG, extra_field: 1 })).toBeNull();
    expect(asFormConfig(null)).toBeNull();
    expect(asFormConfig("{}")).toBeNull();
    expect(asFormConfig({ ...BLANK_CONFIG, present: { ...BLANK_CONFIG.present, view: "html" } })).toBeNull();
  });

  it("缺省的 present.extract 补成 ['code']（02 §2 的默认值）", () => {
    const { extract: _extract, ...present } = BLANK_CONFIG.present;
    expect(asFormConfig({ ...BLANK_CONFIG, present })?.present.extract).toEqual(["code"]);
  });
});

describe("条件的形状与编辑", () => {
  it("单个叶子 / all / any（全是叶子）能展开，match 取对应方式", () => {
    const a = leaf("subject", "contains", "a");
    expect(flattenWhen(a)).toEqual({ shape: "leaf", match: "all", leaves: [a] });
    expect(flattenWhen({ any: [a, a] })).toMatchObject({ shape: "group", match: "any" });
    expect(flattenWhen({ all: [] })).toMatchObject({ shape: "group", match: "all", leaves: [] });
    expect(buildWhen("any", [a])).toEqual({ any: [a] });
  });

  it("域名字段默认 domain_is（02 §3.4：后缀请用 domain_is）", () => {
    expect(newLeaf("sender.domain").op).toBe("domain_is");
    expect(newLeaf().field).toBe("sender.domain");
    expect(newLeaf("link.domains").op).toBe("domain_is");
  });

  it("换字段：同类型保留操作符与取值；跨类型重置为新类型的默认", () => {
    const withCase = { ...leaf("subject", "starts_with", ["a", "b"]), case_sensitive: true };
    expect(changeLeafField(withCase, "body")).toEqual({ ...withCase, field: "body" });
    expect(changeLeafField(leaf("subject", "contains", "x"), "code.present")).toEqual({ field: "code.present", op: "is", value: true });
    expect(changeLeafField(leaf("subject", "contains", "x"), "size")).toEqual({ field: "size", op: "gt", value: 0 });
    expect(changeLeafField(leaf("subject", "contains", "x"), "category")).toEqual({ field: "category", op: "eq", value: [] });
    expect(changeLeafField(leaf("subject", "contains", "x"), "sender.domain").op).toBe("domain_is");
  });

  it("换操作符：case_sensitive 只在文本类操作符之间保留", () => {
    const text = { ...leaf("sender.domain", "contains", ["a.com"]), case_sensitive: true };
    expect(changeLeafOp(text, "regex")).toMatchObject({ op: "regex", case_sensitive: true });
    expect(changeLeafOp(text, "domain_is")).not.toHaveProperty("case_sensitive");
  });

  it("多值标签 ↔ 取值：单个字符串编辑成一项时保持字符串，多项变数组", () => {
    expect(valueItems("a")).toEqual(["a"]);
    expect(valueItems(["a", "b"])).toEqual(["a", "b"]);
    expect(valueItems(true)).toEqual([]);
    expect(itemsToValue(["b"], "a")).toBe("b");
    expect(itemsToValue(["a", "b"], "a")).toEqual(["a", "b"]);
    expect(itemsToValue(["a"], ["x"])).toEqual(["a"]);
    expect(itemsToValue([], "a")).toEqual([]);
  });

  it("新规则 id 不与现有重复", () => {
    const first = newRule([], "allow");
    const rules = [first, { ...first, id: "r2" }, { ...first, id: "r4" }];
    expect(newRule(rules, "deny").id).toBe("r5");
    expect(newRule([first], "deny").effect).toBe("deny");
  });
});

describe("互斥约束的判定", () => {
  it("脱敏或链接处理都会挡住“完整”视图，并写出各自原因", () => {
    const base = templateByKey("full_access");
    expect(fullViewBlockers(base)).toEqual([]);
    expect(fullViewBlockers({ ...base, present: { ...base.present, links: "strip" } })).toEqual(["链接设成了“全部移除”"]);
    const both = { ...base, present: { ...base.present, links: { allow_domains: ["a.com"] }, redact: [{ name: "r", match: { type: "text" as const, pattern: "x" }, scope: ["body" as const], replace: "*" }] } };
    expect(fullViewBlockers(both)).toEqual(["配置了 1 条脱敏规则", "链接设成了“只保留指定域名”"]);
  });

  it("登录链接只有在限定了链接域名后才能提取", () => {
    const base = templateByKey("code_only");
    expect(canExtractLoginLink(base)).toBe(false);
    expect(canExtractLoginLink({ ...base, present: { ...base.present, links: { allow_domains: [] } } })).toBe(false);
    expect(canExtractLoginLink(templateByKey("resale_login_link"))).toBe(true);
  });
});

describe("“N 处未保存”的计数", () => {
  const base = templateByKey("code_only");

  it("没改 = 0；规则按条算（改规则里任意内容算 1 处）；增删各算 1 处", () => {
    expect(countChanges(base, structuredClone(base))).toBe(0);
    const renamed = structuredClone(base);
    (renamed.filter.rules[0] as Rule).name = "改名";
    (renamed.filter.rules[0] as Rule).enabled = false;
    expect(countChanges(base, renamed)).toBe(1);
    const added = structuredClone(base);
    added.filter.rules.push(newRule(added.filter.rules, "deny"));
    expect(countChanges(base, added)).toBe(1);
    const removed = structuredClone(base);
    removed.filter.rules.splice(1, 1);
    expect(countChanges(base, removed)).toBe(1);
  });

  it("标量字段各算 1 处；规则顺序变化不算改动（求值与顺序无关）", () => {
    const edited = structuredClone(base);
    edited.time.window_minutes = 99;
    edited.limits = { max_mails: 9 };
    expect(countChanges(base, edited)).toBe(2);
    const reordered = structuredClone(base);
    reordered.filter.rules.reverse();
    expect(countChanges(base, reordered)).toBe(0);
  });
});

describe("以此邮件创建规则：草稿 → 初始配置", () => {
  const draft: RuleDraft = {
    rule: { id: "draft-2", name: "login.example.org 登录验证码", enabled: true, effect: "allow", when: { all: [leaf("sender.domain", "domain_is", ["login.example.org"]), leaf("category", "eq", "verification")] } },
    subject_pattern: null,
    code_regex: "验证码\\s*(\\d{6})",
    notes: ["说明"],
  };

  it("草稿规则排在最前，模板里的屏蔽规则保留，验证码正则写进 present，且通过校验", () => {
    const built = configFromDraft(draft);
    expect(built?.name).toBe("login.example.org 登录验证码");
    expect(built?.config.filter.rules[0]).toEqual(draft.rule);
    expect(built?.config.filter.rules.slice(1).every((rule) => rule.effect === "deny")).toBe(true);
    expect(built?.config.present.code_regex).toBe("验证码\\s*(\\d{6})");
    expect(validateRuleGroupConfig(built?.config, { regexProbe: "skip" }).errors).toEqual([]);
  });

  it("没有验证码正则时不写 code_regex；没有规则时返回 null", () => {
    expect(configFromDraft({ ...draft, code_regex: null })?.config.present).not.toHaveProperty("code_regex");
    expect(configFromDraft({ ...draft, rule: null })).toBeNull();
  });

  it("空白起点：白名单 + 无规则 = 什么都看不到（失败关闭），校验给出警告而不是错误", () => {
    const result = validateRuleGroupConfig(BLANK_CONFIG, { regexProbe: "skip" });
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain("whitelist_no_enabled_allow");
  });
});
