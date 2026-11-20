import { isApiError } from "../../api/errors";
import { describeAuthError } from "../../lib/auth-messages";
import { Callout, ErrorCallout } from "../../ui";
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

/** 凭据错误统一一句话（后端也不区分原因）；限流显示 Retry-After；其余错误分别说明并带错误码 */
function PasswordErrorNotice({ error }: { error: unknown }) {
  if (isApiError(error, "invalid_credentials")) {
    return <Callout tone="danger" title="登录失败">用户名或密码错误。如果确认无误，账号可能已被停用，请联系管理员。</Callout>;
  }
  const { message, detail } = describeAuthError(error);
  if (isApiError(error, "rate_limited")) return <Callout tone="warning" title="请求太频繁">{message}</Callout>;
  return <ErrorCallout title={isApiError(error) ? "服务器出错" : "无法连接服务器"} message={message} detail={detail} />;
}

type Props = { notice: LoginNotice | null; providerName: (slug: string) => string | null };

export function LoginNotices({ notice, providerName }: Props) {
  if (notice === null) return null;
  if (notice.kind === "mfa") return <MfaFailureNotice failure={notice.failure} />;
  if (notice.kind === "password_error") return <PasswordErrorNotice error={notice.error} />;
  const outcome = describeOAuthResult(notice.code, notice.provider === null ? null : providerName(notice.provider) ?? notice.provider);
  return <Callout tone={outcome.tone} title={outcome.title}>{outcome.detail}</Callout>;
}
