// 邮件分类关键词表（02 §3.6），中、英、日起步。词表任何改动都要递增 constants.ts 的 PARSER_VERSION。
// 全部小写（匹配前会把文本转小写）。
// subject：只在主题里匹配，可以放比较宽的词；
// body：在主题与正文里匹配，必须是具体短语——正文页脚常有"如非本人操作请修改密码"，宽泛的词会把普通验证码邮件误判成高危类别。

export type CategoryKeywords = { subject: readonly string[]; body: readonly string[] };

export const EMAIL_CHANGE: CategoryKeywords = {
  subject: [
    "email change", "change of email", "change your email", "update your email", "email address change",
    "邮箱变更", "更换邮箱", "修改邮箱", "更改邮箱", "变更邮箱", "邮箱更换",
    "メールアドレス変更", "メールアドレスの変更", "メールアドレスを変更",
  ],
  body: [
    "change your email", "change of email address", "email address change", "update your email address",
    "confirm your new email", "verify your new email", "new email address", "email address was changed",
    "更换邮箱", "更改邮箱", "修改邮箱", "变更邮箱", "新邮箱", "邮箱变更",
    "メールアドレスを変更", "メールアドレスの変更", "新しいメールアドレス",
  ],
};

export const PASSWORD_RESET: CategoryKeywords = {
  subject: [
    "reset your password", "password reset", "reset password", "forgot password", "forgot your password",
    "recover your password", "change your password", "change password", "password change",
    "重设密码", "重置密码", "找回密码", "修改密码", "密码重置", "忘记密码", "重設密碼", "重置密碼",
    "パスワードのリセット", "パスワード再設定", "パスワードを再設定", "パスワードをリセット", "パスワード変更",
    "パスワードの変更", "パスワードをお忘れ",
  ],
  body: [
    "reset your password", "password reset", "reset password", "forgot your password", "recover your password",
    "set a new password", "create a new password", "choose a new password",
    "重设密码", "重置密码", "找回密码", "密码重置", "忘记密码", "重設密碼", "重置密碼",
    "正在修改密码", "修改密码的验证码", "修改密码验证码", "更改密码的验证码",
    "パスワードのリセット", "パスワードを再設定", "パスワードの再設定", "パスワードをリセット", "パスワード再設定",
    "パスワードを変更するための",
  ],
};

export const SECURITY_CHANGE: CategoryKeywords = {
  subject: [
    "security alert", "two-factor authentication disabled", "two-step verification disabled", "account recovery",
    "recover your account", "delete your account", "account deletion", "new passkey", "sign-in method",
    "安全提醒", "安全警报", "安全通知", "关闭两步验证", "停用两步验证", "账号恢复", "找回账号", "删除账号", "注销账号",
    "新的登录方式",
    "セキュリティ通知", "セキュリティ警告", "2段階認証をオフ", "二段階認証を無効", "アカウントの復旧", "アカウントを削除",
    "新しいログイン方法",
  ],
  body: [
    "two-factor authentication has been disabled", "two-factor authentication was turned off",
    "two-step verification has been turned off", "turned off two-step verification", "turned off two-factor",
    "disabled two-factor", "disable two-factor", "remove two-factor", "recovery email", "recovery phone",
    "recover your account", "restore your account", "delete your account", "account deletion",
    "close your account", "deactivate your account", "passkey was added", "added a passkey", "new sign-in method",
    "关闭两步验证", "停用两步验证", "关闭双重验证", "关闭二次验证", "账号恢复", "找回账号", "恢复账号",
    "删除账号", "注销账号", "删除账户", "注销账户", "新增登录方式", "添加登录方式", "新的登录方式", "通行密钥已添加",
    "2段階認証をオフ", "二段階認証を無効", "二段階認証をオフ", "アカウントの復旧", "アカウントを削除",
    "アカウント削除", "新しいログイン方法", "パスキーが追加",
  ],
};

export const BILLING: CategoryKeywords = {
  subject: [
    "invoice", "receipt", "payment", "billing", "subscription", "renewal", "refund", "your order",
    "账单", "收据", "发票", "订阅", "续费", "付款", "支付", "扣款", "退款", "订单",
    "請求書", "領収書", "ご請求", "お支払い", "支払い", "定期購入", "サブスクリプション", "返金", "ご注文",
  ],
  body: [
    // 正文里单独的 subscription / 订阅 / サブスクリプション 太宽（"Manage your email subscription preferences" 是营销页脚），只收具体短语
    "your receipt", "payment receipt", "payment successful", "payment failed", "invoice", "billing",
    "subscription renewed", "subscription receipt", "subscription payment", "your subscription has", "your subscription will",
    "renewal receipt", "you were charged", "you have been charged", "refund",
    "账单", "收据", "发票", "订阅已", "订阅将", "订阅成功", "订阅续费", "付款成功", "支付成功", "扣款", "退款",
    "請求書", "領収書", "お支払い", "サブスクリプションの更新", "サブスクリプションが更新", "返金",
  ],
};

/** 没有验证码但有链接时，出现这些词也算 verification（登录链接类邮件） */
export const LOGIN_LINK_KEYWORDS: readonly string[] = [
  "sign in", "log in", "login link", "magic link", "sign-in link", "confirm your email", "verify your email",
  "登录链接", "登录", "验证邮箱", "确认邮箱", "ログイン", "メールアドレスの確認",
];
