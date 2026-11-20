import { describe, expect, it } from "vitest";
import { BLANK_CONFIG } from "../config";
import { countEditorChanges, descriptionProblem, parseJsonConfig, prettyJson } from "./editor-state";

describe("JSON 模式的解析", () => {
  it("语法错误：说明原因，不抛出", () => {
    const result = parseJsonConfig('{ "time": ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("JSON 语法错误");
  });

  it("不是对象（数组、字符串、null）都拒绝", () => {
    for (const text of ["[]", '"x"', "null", "42"]) {
      const result = parseJsonConfig(text);
      expect(result.ok, text).toBe(false);
    }
  });

  it("往返：对象 → 文本 → 对象相同，含嵌套与未知字段（交给校验报，不在解析时吞掉）", () => {
    const value = { ...BLANK_CONFIG, unknown_field: { nested: [1, 2, { deep: true }] } };
    const parsed = parseJsonConfig(prettyJson(value));
    expect(parsed.ok && parsed.value).toEqual(value);
  });
});

describe("未保存计数（含名称与说明）", () => {
  const base = { name: "n", description: "d", config: BLANK_CONFIG };

  it("名称、说明各算一处；配置不变 = 0；补齐默认值不算改动", () => {
    expect(countEditorChanges(base, { ...base })).toBe(0);
    expect(countEditorChanges({ ...base, name: "x", description: "y" }, base)).toBe(2);
    const { extract: _drop, ...present } = BLANK_CONFIG.present;
    expect(countEditorChanges({ ...base, config: { ...BLANK_CONFIG, present } }, base)).toBe(0);
  });

  it("配置不合法（JSON 里写坏了）也能比较，不抛出", () => {
    expect(countEditorChanges({ ...base, config: { broken: true } }, base)).toBeGreaterThan(0);
  });

  it("说明过长报错", () => {
    expect(descriptionProblem("x".repeat(501))).toMatch(/最长 500/);
    expect(descriptionProblem("")).toBeNull();
  });
});
