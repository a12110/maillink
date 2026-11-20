import { oauthResultCodeSchema } from "@maillink/shared";
import type { OAuthResultCode } from "@maillink/shared";

export type OAuthOutcome = { tone: "info" | "warning" | "danger"; title: string; detail: string };

/**
 * OAuth 回调结果码（`oauthResultCodeSchema`，login 回 /login、link 回 /account）的中文说明。
 * 用 Record 保证后端新增结果码时这里编译不过。
 */
const OUTCOMES: Record<OAuthResultCode, OAuthOutcome> = {
  ok: { tone: "info", title: "登录成功", detail: "正在进入系统。" },
  linked: { tone: "info", title: "绑定成功", detail: "这个第三方账号已绑定到你的账号，之后可以用它登录。" },
  mfa_required: { tone: "info", title: "还需要两步验证", detail: "请输入验证码完成登录。" },
  already_linked: { tone: "warning", title: "已经绑定过了", detail: "这个第三方账号已经绑定在你的账号上，不需要重复绑定。" },
  identity_taken: { tone: "danger", title: "该第三方账号已被其他用户绑定", detail: "同一个第三方账号只能绑定到一个用户。请先在原账号里解绑，或换一个第三方账号。" },
  not_linked: { tone: "warning", title: "这个第三方账号还没有绑定任何用户", detail: "请先用用户名密码或通行密钥登录，再到“账号安全”里绑定它。" },
  account_disabled: { tone: "danger", title: "账号已被停用", detail: "请联系管理员。" },
  link_requires_login: { tone: "warning", title: "绑定需要先登录", detail: "登录状态已失效。请重新登录后，再到“账号安全”里绑定。" },
  provider_unavailable: { tone: "danger", title: "这种登录方式暂时不可用", detail: "提供方已被停用，或站点关闭了第三方登录。请改用其他方式，或联系管理员。" },
  state_invalid: { tone: "danger", title: "登录请求已失效", detail: "请求超过 10 分钟，或不是在发起登录的同一个浏览器里完成的。请重新发起。" },
  denied: { tone: "warning", title: "授权被取消", detail: "你在提供方的页面取消了授权，或提供方拒绝了这次请求。" },
  exchange_failed: { tone: "danger", title: "无法从提供方换取登录凭证", detail: "可能是网络问题。稍后重试；持续失败请联系管理员检查提供方配置。" },
  token_invalid: { tone: "danger", title: "提供方返回的身份凭证没有通过校验", detail: "出于安全考虑已拒绝登录。请联系管理员检查提供方配置。" },
  profile_invalid: { tone: "danger", title: "提供方没有返回可用的账号资料", detail: "缺少必要的用户标识。请联系管理员检查提供方的字段映射。" },
  signup_failed: { tone: "danger", title: "没能为你创建账号", detail: "站点未开放注册，或这个提供方不允许自动建号。请联系管理员。" },
};

/** 未知的结果码（后端比前端新）不能吞掉：原样展示结果码 */
export function describeOAuthResult(code: string, providerName: string | null): OAuthOutcome {
  const parsed = oauthResultCodeSchema.safeParse(code);
  const outcome: OAuthOutcome = parsed.success
    ? OUTCOMES[parsed.data]
    : { tone: "danger", title: "第三方登录没有完成", detail: `收到了无法识别的结果码 “${code}”。请重试，仍然失败请联系管理员。` };
  if (providerName === null) return outcome;
  return { ...outcome, title: `${providerName}：${outcome.title}` };
}
