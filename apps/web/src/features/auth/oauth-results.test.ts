import { oauthResultCodeSchema } from "@maillink/shared";
import { describe, expect, it } from "vitest";
import { describeOAuthResult } from "./oauth-results";

describe("OAuth 回跳结果码", () => {
  it.each(oauthResultCodeSchema.options)("%s 有中文说明", (code) => {
    const outcome = describeOAuthResult(code, null);
    expect(outcome.title).toMatch(/[\u4e00-\u9fa5]/);
    expect(outcome.detail).toMatch(/[\u4e00-\u9fa5]/);
    expect(outcome.detail).not.toContain(code);
  });

  it("每个结果码的说明互不相同（没有复制粘贴的占位文案）", () => {
    const titles = oauthResultCodeSchema.options.map((code) => describeOAuthResult(code, null).title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("带提供方名称时标题加前缀", () => {
    expect(describeOAuthResult("denied", "GitHub").title).toBe("GitHub：授权被取消");
  });

  it("未知结果码不吞：原样展示在说明里", () => {
    const outcome = describeOAuthResult("brand_new_code", null);
    expect(outcome.tone).toBe("danger");
    expect(outcome.detail).toContain("brand_new_code");
  });
});
