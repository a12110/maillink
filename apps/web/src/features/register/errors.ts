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
