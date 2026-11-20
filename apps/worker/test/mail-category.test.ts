import { describe, expect, it } from "vitest";
import { classifyMail, normalizeText } from "../src/mail-parse";
import type { MailCategory } from "../src/mail-parse";
import { dropNotYouAdvice } from "../src/mail-parse/category";

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
  ["email_change", "fr", "Changement d’adresse e-mail", "Confirmez votre nouvelle adresse e-mail."],
  ["email_change", "de", "E-Mail-Adresse ändern", "Bitte bestätigen Sie Ihre neue E-Mail-Adresse."],
  ["email_change", "es", "Cambio de correo electrónico", "Confirma tu nueva dirección de correo."],
  ["email_change", "pt", "Alteração de e-mail", "Confirme o novo endereço de e-mail."],
  ["email_change", "it", "Modifica dell’indirizzo email", "Conferma il nuovo indirizzo email."],
  ["email_change", "ko", "이메일 주소 변경", "새 이메일 주소를 확인하세요."],
  ["email_change", "ru", "Смена адреса электронной почты", "Подтвердите новый адрес электронной почты."],
  ["password_reset", "fr", "Réinitialisation du mot de passe", "Cliquez pour choisir un nouveau mot de passe."],
  ["password_reset", "de", "Passwort zurücksetzen", "Klicken Sie hier, um Ihr Passwort zurückzusetzen."],
  ["password_reset", "es", "Restablecer contraseña", "Haz clic para restablecer tu contraseña."],
  ["password_reset", "pt", "Redefinição de senha", "Clique para redefinir sua senha."],
  ["password_reset", "it", "Reimpostazione della password", "Fai clic per reimpostare la password."],
  ["password_reset", "ko", "비밀번호 재설정", "비밀번호를 재설정하려면 클릭하세요."],
  ["password_reset", "ru", "Сброс пароля", "Нажмите, чтобы сбросить пароль."],
  ["security_change", "fr", "Alerte de sécurité", "L’authentification à deux facteurs a été désactivée."],
  ["security_change", "de", "Sicherheitswarnung", "Die Zwei-Faktor-Authentifizierung wurde deaktiviert."],
  ["security_change", "es", "Alerta de seguridad", "La verificación en dos pasos ha sido desactivada."],
  ["security_change", "pt", "Alerta de segurança", "A verificação em duas etapas foi desativada."],
  ["security_change", "it", "Avviso di sicurezza", "La verifica in due passaggi è stata disattivata."],
  ["security_change", "ko", "보안 알림", "2단계 인증이 해제되었습니다."],
  ["security_change", "ru", "Оповещение безопасности", "Двухфакторная аутентификация отключена."],
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

  it("页脚条件句：只丢紧跟引导语逗号、以建议动词开头的那一个分句", () => {
    const code = "140140";
    expect(classify("Your code", "Code 140140. If you didn’t request this, you can reset your password.", code)).toBe("verification");
    expect(classify("验证码", "验证码 140140。如非本人操作，请立即重置密码。", code)).toBe("verification");
    expect(classify("Your code", "Code 140140. If this wasn't you, we recommend you reset your password.", code)).toBe("verification");
    // 前半句本身点明用途
    expect(classify("Your code", "Code 140140. If you didn't request a password reset, ignore this email.", code)).toBe("password_reset");
    // 建议句之外另有高危说法
    expect(classify("Your code", "If you didn't request this, ignore it. Use code 140140 to reset your password.", code)).toBe("password_reset");
    // 没有逗号的条件句不处理
    expect(classify("Your code", "Code 140140. If you did not request this reset your password.", code)).toBe("password_reset");
    // 逗号后不是建议动词开头：不丢
    expect(classify("Your code", "Code 140140. If this wasn't you, sign out of all other devices.", code)).toBe("security_change");
    expect(classify("Your code", "Code 140140. If this wasn't you, we already started to reset your password.", code)).toBe("password_reset");
    expect(classify("Your code", "Code 140140. If this wasn't you, changed settings: reset your password.", code)).toBe("password_reset");
    // 其他语言不丢
    expect(classify("Code", "Code 140140. Si ce n'était pas vous, réinitialiser votre mot de passe.", code)).toBe("password_reset");
  });

  it("建议分句在 , ; : — 处结束，之后的分句照常匹配", () => {
    const code = "140140";
    expect(classify("Your code", "Code 140140. If this wasn't you, reset your password, two-factor authentication has been disabled.", code)).toBe("security_change");
    expect(classify("Your code", "Code 140140. If this wasn't you, change your password — this code lets you reset your password", code)).toBe("password_reset");
    expect(classify("Your code", "Code 140140. If this wasn't you, change your password; your password reset is pending.", code)).toBe("password_reset");
    expect(classify("验证码", "验证码 140140。如非本人操作，请修改密码，您正在重置密码。", code)).toBe("password_reset");
  });

  it("建议动词后接风险名词：整个建议分句不参与匹配（已知边界）", () => {
    expect(classify("Your code", "Code 140140. If this wasn't you, update your recovery email.", "140140")).toBe("verification");
    expect(dropNotYouAdvice("code 1. if this wasn't you, update your recovery email. thanks")).toBe("code 1. if this wasn't you, . thanks");
  });

  it("建议分句最长 80 字符：恰好 80 丢弃，81 不丢", () => {
    const clauseOf = (length: number) => `reset your password ${"x".repeat(length - "reset your password ".length)}`;
    const lead = "code 1. if you didn't request this, ";
    expect(clauseOf(80)).toHaveLength(80);
    expect(dropNotYouAdvice(`${lead}${clauseOf(80)}. bye`)).toBe(`${lead}. bye`);
    expect(dropNotYouAdvice(`${lead}${clauseOf(81)}. bye`)).toBe(`${lead}${clauseOf(81)}. bye`);
    expect(classify("Your code", `${lead}${clauseOf(81)}.`, "1")).toBe("password_reset");
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
