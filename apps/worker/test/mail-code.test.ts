import { describe, expect, it } from "vitest";
import { extractAiCode, extractBuiltinCode, resolveCode } from "../src/mail-parse";
import { normalizeText } from "../src/mail-parse";

const code = (body: string, subject = "") => extractBuiltinCode(normalizeText(subject), normalizeText(body));

describe("内置验证码提取：正例", () => {
  const positives: Array<[string, string, string]> = [
    ["英文：code is", "Your verification code is 482913.", "482913"],
    ["英文：Use code", "Use code 907351 to finish signing in.", "907351"],
    ["英文：冒号", "Verification code: 5521", "5521"],
    ["英文：关键词在数字之后", "123456 is your verification code", "123456"],
    ["英文：关键词在数字之后，中间有品牌词", "738204 is your Example security code", "738204"],
    ["英文：Google 风格前缀 G-", "G-912345 is your Google verification code", "912345"],
    ["英文：OTP", "Your OTP is 774411", "774411"],
    ["英文：one-time password", "Your one-time password: 998877", "998877"],
    ["英文：中间隔几个词", "Enter the code below to continue: 654321", "654321"],
    ["中文：验证码是", "您的验证码是 704512，10 分钟内有效", "704512"],
    ["中文：冒号", "验证码：123789", "123789"],
    ["中文：全角数字与冒号", "验证码：１２３７８９", "123789"],
    ["中文：繁体", "您的驗證碼為 246135", "246135"],
    ["日文：コード：", "ログイン用の認証コード：538204", "538204"],
    ["日文：コードは", "認証コードは 193746 です", "193746"],
    ["数字带空格", "Your verification code is 123 456.", "123456"],
    ["数字带连字符", "Your code: 123-456", "123456"],
    ["4-4 分组", "Your security code is 1234 5678", "12345678"],
    ["字母数字混合", "Your code: A1B2C3", "A1B2C3"],
    ["字母数字混合（小写）", "confirmation code x7k2m9", "x7k2m9"],
    ["零宽字符插在数字之间", "Your verification code is 48\u200B29\u200C13", "482913"],
  ];
  it.each(positives)("%s", (_name, body, expected) => {
    expect(code(body)).toBe(expected);
  });

  it("掩码尾号不抢走真正的验证码", () => {
    expect(code("Code sent to ****1234. Enter the code: 908172")).toBe("908172");
    expect(code("Code sent to ****1234. Enter the code: 908172")).not.toBe("1234");
  });

  it("先看主题再看正文：主题里的码优先", () => {
    expect(code("Your verification code is 222222", "New sign-in code: 907351")).toBe("907351");
  });

  it("主题没有时回退到正文", () => {
    expect(code("Use code 907351 now", "Welcome back")).toBe("907351");
  });

  it("第一个关键词不合格时继续找下一个", () => {
    expect(code("Code of conduct updated in 2026. Your verification code is 135790.")).toBe("135790");
  });
});

describe("内置验证码提取：干扰项不能误判", () => {
  const negatives: Array<[string, string]> = [
    ["年份紧邻关键词", "Your verification code was updated in 2026"],
    ["年份是候选", "verification code: 2026"],
    ["金额", "Verification code total: $1234"],
    ["金额带千分位", "Your code balance is 1,234"],
    ["小数", "security code 12.345"],
    ["百分比", "code 1000%"],
    ["日期 YYYYMMDD", "verification code 20261120"],
    ["日期带连字符", "verification code 2026-11-20"],
    ["电话（分组）", "verification call: 555-123-4567"],
    ["电话（带加号）", "code line +8613800138000"],
    ["订单号在关键词与数字之间", "Your verification code for order 8 is 123456"],
    ["订单号词在间隔里", "confirmation code order 998877"],
    ["时长（秒）", "Your verification code is valid for 1800 seconds"],
    ["时长（分钟）", "验证码 5000 分钟"],
    ["数字太短", "Your code is 123"],
    ["数字太长", "Your code is 123456789"],
    ["三组数字", "Your code is 123 456 789"],
    ["优惠码", "Use promo code SAVE2026 at checkout"],
    ["关键词在别的词里", "barcode 123456"],
    ["隔着句号", "Enter your verification code. 654321 items shipped"],
    ["距离太远", "verification code" + " pad".repeat(10) + " 654321"],
    ["隔着其他数字", "verification code 12 then 654321"],
    ["没有关键词", "Your PIN-less pass is 654321"],
    ["纯字母", "Your code is ABCDEF"],
    ["数字紧贴字母形成更长的词", "code 1234abcdefg"],
    ["关键词后是 # 号码", "code #123456"],
    ["掩码尾号", "Code sent to ****1234"],
    ["掩码尾号（圆点）", "verification code sent to •••• 1234 ****5678"],
    ["订单代码（order 前缀）", "Order code ORD12345"],
    ["参考码（reference 前缀）", "reference code 77889911"],
    ["折扣码带折扣字样", "Use code SAVE20 for 20% off your next order"],
    ["折扣码带 off", "Use code SPRING2 to get 15 off"],
  ];
  it.each(negatives)("%s", (_name, body) => {
    expect(code(body)).toBeNull();
  });
});

describe("ai_extract", () => {
  const meta = (extract: unknown) => JSON.stringify({ ai_extract: extract, extracted_at: "2026-11-20T00:00:00Z" });

  it("type=auth_code 时采用 result", () => {
    expect(extractAiCode(meta({ type: "auth_code", result: "445566" }))).toBe("445566");
    expect(extractAiCode(meta({ type: "auth_code", result: 445566 }))).toBe("445566");
  });

  it("其他类型、空结果、过长、缺 metadata：不采用", () => {
    expect(extractAiCode(meta({ type: "auth_link", result: "https://x.example" }))).toBeNull();
    expect(extractAiCode(meta({ type: "auth_code", result: "" }))).toBeNull();
    expect(extractAiCode(meta({ type: "auth_code", result: null }))).toBeNull();
    expect(extractAiCode(meta({ type: "auth_code", result: "x".repeat(33) }))).toBeNull();
    expect(extractAiCode(null)).toBeNull();
    expect(extractAiCode("{}")).toBeNull();
  });

  it("不是合法 JSON：回退并留下警告", () => {
    expect(extractAiCode("not json")).toBeNull();
  });

  it("优先于内置提取，并标注来源", () => {
    const withAi = resolveCode("", "Use code 112233 to sign in", meta({ type: "auth_code", result: "445566" }));
    expect(withAi).toEqual({ code: "445566", source: "ai_extract" });
    expect(resolveCode("", "Use code 112233 to sign in", null)).toEqual({ code: "112233", source: "builtin" });
    expect(resolveCode("", "nothing here", null)).toEqual({ code: null, source: null });
  });
});
