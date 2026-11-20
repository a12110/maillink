import { describeErrorWith } from "../../lib/api-error-text";
import type { ErrorTexts } from "../../lib/api-error-text";
import { TURNSTILE_ERROR_TEXTS } from "../turnstile/errors";

/** 注册接口的错误说明；username_taken / email_taken / password_too_short 另在对应字段下就地显示 */
export const REGISTER_ERROR_TEXTS: ErrorTexts = {
  ...TURNSTILE_ERROR_TEXTS,
  username_taken: "用户名已被使用，请换一个。",
  email_taken: "这个邮箱已被其他用户使用。",
  password_too_short: (serverMessage) => `${serverMessage}（管理员设置的最小长度）。`,
  login_method_disabled: "管理员已关闭密码登录，注册暂不可用。",
  not_found: "目前未开放注册。",
};

export function describeRegisterError(error: unknown): { message: string; detail: string } {
  return describeErrorWith(REGISTER_ERROR_TEXTS, error);
}

/** 注册请求已成功（账号已创建），但随后获取会话失败；保留原始错误，页面据此提示去登录，而不是当作注册失败 */
export class SessionAfterRegisterError extends Error {
  constructor(readonly original: unknown) {
    super("账号已创建，但获取登录状态失败");
    this.name = "SessionAfterRegisterError";
  }
}
