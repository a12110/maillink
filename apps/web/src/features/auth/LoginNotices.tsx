import { isApiError } from "../../api/errors";
import { describeAuthError } from "../../lib/auth-messages";
import { Callout, ErrorCallout } from "../../ui";
import { describeTurnstileError } from "../turnstile/errors";
import type { LoginNotice, MfaFailure } from "./login-flow";
import { describeOAuthResult } from "./oauth-results";

function MfaFailureNotice({ failure }: { failure: MfaFailure }) {
  switch (failure.kind) {
    case "retry":
      return <Callout tone="danger" title="验证失败">{failure.message}</Callout>;
    case "restart":
      return <Callout tone="warning" title="登录验证已失效">{failure.message}。请重新输入用户名和密码。</Callout>;
    case "locked":
      return <Callout tone="danger" title="验证被暂时锁定">{failure.message}。这是为了防止猜测验证码，锁定期间用验证码或恢复码都无法登录。</Callout>;
    case "rate_limited":
      return <Callout tone="warning" title="请求太频繁">{failure.message}</Callout>;
    case "error":
      return <ErrorCallout title="验证没有完成" {...describeAuthError(failure.error)} />;
  }
}

/** 密码登录能出现的、需要单独标题的错误码；其余服务端错误统一“服务器出错”，断网“无法连接服务器” */
const PASSWORD_ERROR_TITLES: Readonly<Record<string, string>> = {
  login_method_disabled: "密码登录已关闭",
  turnstile_failed: "人机验证没有通过",
  turnstile_unavailable: "人机验证服务暂时不可用",
  turnstile_not_configured: "人机验证尚未配置完整",
  unexpected_response: "服务器返回了无法识别的响应",
};

function passwordErrorText(error: unknown): { message: string; detail: string } {
  if (isApiError(error, "login_method_disabled")) {
    return { message: "管理员已关闭密码登录，请改用页面上的其他登录方式，或联系管理员。", detail: `${error.code} · HTTP ${error.status}` };
  }
  if (isApiError(error) && error.code.startsWith("turnstile_")) return describeTurnstileError(error);
  return describeAuthError(error);
}

/** 凭据错误统一一句话（后端也不区分原因）；限流显示 Retry-After；其余错误分别说明并带错误码 */
function PasswordErrorNotice({ error }: { error: unknown }) {
  if (isApiError(error, "invalid_credentials")) {
    return <Callout tone="danger" title="登录失败">用户名或密码错误。如果确认无误，账号可能已被停用，请联系管理员。</Callout>;
  }
  const { message, detail } = passwordErrorText(error);
  if (isApiError(error, "rate_limited")) return <Callout tone="warning" title="请求太频繁">{message}</Callout>;
  const title = isApiError(error) ? (PASSWORD_ERROR_TITLES[error.code] ?? "服务器出错") : "无法连接服务器";
  return <ErrorCallout title={title} message={message} detail={detail} />;
}

type Props = { notice: LoginNotice | null; providerName: (slug: string) => string | null };

export function LoginNotices({ notice, providerName }: Props) {
  if (notice === null) return null;
  if (notice.kind === "mfa") return <MfaFailureNotice failure={notice.failure} />;
  if (notice.kind === "password_error") return <PasswordErrorNotice error={notice.error} />;
  const outcome = describeOAuthResult(notice.code, notice.provider === null ? null : providerName(notice.provider) ?? notice.provider);
  return <Callout tone={outcome.tone} title={outcome.title}>{outcome.detail}</Callout>;
}
