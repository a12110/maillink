// 验证码关键词表（02 §4.6）。词表任何改动都要递增 constants.ts 的 PARSER_VERSION。
// 英文关键词里的空格匹配"空格或连字符"（`one-time code` / `one time code`）；匹配不区分大小写。

/** 验证码关键词：候选数字必须紧邻其中之一 */
export const CODE_KEYWORDS: readonly string[] = [
  // 中文（简体 / 繁体）
  "验证码", "驗證碼", "验证代码", "驗證代碼", "校验码", "校驗碼", "动态码", "動態碼", "动态密码", "動態密碼",
  "安全码", "安全碼", "确认码", "確認碼", "认证码", "認證碼", "一次性密码", "一次性密碼", "登录码", "登入碼",
  // 日文
  "認証コード", "確認コード", "検証コード", "認証番号", "確認番号", "セキュリティコード", "ワンタイムパスワード",
  "ワンタイムコード", "ログインコード",
  // English
  "verification code", "security code", "confirmation code", "login code", "log in code", "sign in code",
  "sign-in code", "one time code", "one time password", "one time passcode", "authentication code",
  "auth code", "access code", "verify code", "2fa code", "passcode", "otp", "code",
];

/**
 * 紧挨在这些词后面的 code 不是验证码（优惠码、邮编、错误码……）。
 * 只对英文生效：中日文的关键词本身足够具体（"优惠码"不在词表里）。
 */
export const CODE_NEGATIVE_PREFIXES: readonly string[] = [
  "promo", "promotional", "discount", "coupon", "referral", "invite", "invitation", "gift", "zip", "postal",
  "area", "country", "source", "error", "status", "tracking", "product", "redeem", "voucher", "bar", "qr",
  "dial", "bonus", "reward", "student", "order", "reference",
];

/**
 * 候选与关键词之间出现这些词，说明数字是订单号、金额、电话等，不是验证码。
 * 注意不含"番号"这类会出现在关键词里的词。
 */
export const CODE_GAP_BLOCKERS: readonly string[] = [
  "order", "invoice", "tracking", "phone", "tel", "mobile", "amount", "total", "price", "balance", "card",
  "reference", "订单", "訂單", "电话", "電話", "手机", "手機", "金额", "金額", "余额", "餘額", "单号", "單號",
  "注文", "請求", "価格", "残高", "電話番号",
];

/** 数字后面紧跟这些单位，说明是金额、时长、年月日，不是验证码 */
export const CODE_UNIT_SUFFIXES: readonly string[] = [
  "元", "円", "块", "人民币", "美元", "rmb", "cny", "usd", "jpy", "eur", "dollars", "dollar", "yuan", "yen",
  "分钟", "分鐘", "分", "秒", "小时", "小時", "天", "年", "月", "日", "号", "号码",
  "minutes", "minute", "mins", "min", "seconds", "second", "secs", "sec", "hours", "hour", "days", "day",
  "years", "year", "%",
];
