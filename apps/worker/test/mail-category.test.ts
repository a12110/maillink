import { describe, expect, it } from "vitest";
import { classifyMail, normalizeText } from "../src/mail-parse";
import type { MailCategory } from "../src/mail-parse";

const classify = (subject: string, body: string, code: string | null = null, links: string[] = []): MailCategory =>
  classifyMail({ subject: normalizeText(subject), body: normalizeText(body), code, links });

// [分类, 语言, 主题, 正文]
const SAMPLES: Array<[MailCategory, string, string, string]> = [
  ["email_change", "en", "Confirm your new email address", "We received a request to change the email address on your account."],
  ["email_change", "zh", "更换邮箱确认", "您正在更换邮箱，请确认新邮箱。"],
  ["email_change", "ja", "メールアドレス変更のお知らせ", "メールアドレスを変更するには確認してください。"],
  ["password_reset", "en", "Reset your password", "Click the link to choose a new one."],
  ["password_reset", "zh", "重置密码", "您正在重设密码。"],
  ["password_reset", "ja", "パスワードの再設定", "パスワードを再設定するにはこちら。"],
  ["security_change", "en", "Security alert", "Two-factor authentication was turned off for your account."],
  ["security_change", "zh", "安全提醒", "您的账号已关闭两步验证。"],
  ["security_change", "ja", "セキュリティ通知", "2段階認証をオフにしました。"],
  ["billing", "en", "Your receipt from Example", "Thanks for your payment. Invoice attached."],
  ["billing", "zh", "您的账单", "感谢付款，发票见附件。"],
  ["billing", "ja", "領収書のお知らせ", "お支払いありがとうございます。"],
  ["other", "en", "Weekly digest", "Five things worth reading."],
  ["other", "zh", "每周精选", "五篇值得阅读的文章。"],
  ["other", "ja", "週刊ダイジェスト", "読む価値のある記事です。"],
];

describe("分类：每类、每种语言都有样本", () => {
  it.each(SAMPLES)("%s（%s）：%s", (category, _lang, subject, body) => {
    expect(classify(subject, body)).toBe(category);
  });
});

describe("分类：顺序与边界", () => {
  it("重设密码的验证码判为 password_reset，不是 verification", () => {
    expect(classify("重设密码验证码", "您正在重设密码，验证码为 639201", "639201")).toBe("password_reset");
    expect(classify("Your code", "Use this code to reset your password: 123456", "123456")).toBe("password_reset");
    expect(classify("認証コード", "パスワードをリセットするための認証コード：123456", "123456")).toBe("password_reset");
  });

  it("email_change 优先于 password_reset，password_reset 优先于 security_change，security_change 优先于 billing", () => {
    expect(classify("Confirm your new email address", "reset your password too")).toBe("email_change");
    expect(classify("Reset your password", "two-factor authentication was turned off")).toBe("password_reset");
    expect(classify("Security alert", "invoice attached")).toBe("security_change");
  });

  it("有验证码、没命中高危类别：verification（中英日）", () => {
    expect(classify("Sign-in code", "Use code 907351", "907351")).toBe("verification");
    expect(classify("登录验证码", "您的验证码是 704512", "704512")).toBe("verification");
    expect(classify("認証コード", "認証コード：538204", "538204")).toBe("verification");
  });

  it("没有验证码但有登录链接字样：verification；没有链接：other", () => {
    expect(classify("Your magic link", "Click to sign in", null, ["https://x.example/login"])).toBe("verification");
    expect(classify("Your magic link", "Click to sign in", null, [])).toBe("other");
  });

  it("页脚里宽泛的词不触发高危类别（正文只匹配具体短语）", () => {
    expect(classify("Your sign-in code", "Code 482913. If this wasn't you, change your password.", "482913")).toBe("verification");
  });

  it("营销页脚里的 subscription / 订阅 / サブスクリプション 不会把登录码判成 billing", () => {
    expect(classify("Your sign-in code", "Code 482913. Manage your email subscription preferences.", "482913")).toBe("verification");
    expect(classify("登录验证码", "验证码 704512。管理订阅偏好。", "704512")).toBe("verification");
    expect(classify("認証コード", "認証コード：538204 サブスクリプション設定の管理", "538204")).toBe("verification");
  });

  it("订阅的具体短语仍判 billing", () => {
    expect(classify("Update", "Your subscription renewed successfully.")).toBe("billing");
    expect(classify("更新", "您的订阅已续期。")).toBe("billing");
    expect(classify("Your subscription", "Your subscription has been cancelled.")).toBe("billing");
  });

  it("改密码验证码（具体措辞）判为 password_reset", () => {
    expect(classify("Your code", "Use this code to set a new password: 123456", "123456")).toBe("password_reset");
    expect(classify("验证码", "您正在修改密码，验证码 123456", "123456")).toBe("password_reset");
    expect(classify("验证码", "这是修改密码的验证码：123456", "123456")).toBe("password_reset");
    expect(classify("認証コード", "パスワードを変更するための認証コード：123456", "123456")).toBe("password_reset");
  });

  it("不区分大小写", () => {
    expect(classify("RESET YOUR PASSWORD", "")).toBe("password_reset");
  });
});
