import type { PublicConfig } from "@maillink/shared";
import { Callout } from "../../ui";
import { TurnstileWidget } from "../turnstile/TurnstileWidget";
import type { TurnstileLoader } from "../turnstile/loader";

/** 密码登录表单是否要 Turnstile：系统启用且作用范围含 login（通行密钥与 OAuth 不经过这个表单，不受影响） */
export function loginNeedsTurnstile(config: Pick<PublicConfig, "turnstile"> | undefined): boolean {
  return config !== undefined && config.turnstile.enabled && config.turnstile.scopes.includes("login");
}

/** 启用了登录人机验证却没填 site key：提交被禁用并说明，不降级放行 */
export function loginTurnstileMisconfigured(config: Pick<PublicConfig, "turnstile"> | undefined): boolean {
  return loginNeedsTurnstile(config) && config?.turnstile.site_key === "";
}

type Props = {
  config: Pick<PublicConfig, "turnstile">;
  loader?: TurnstileLoader;
  onToken: (token: string | null) => void;
  resetKey: number;
};

export function LoginTurnstile({ config, loader, onToken, resetKey }: Props) {
  if (!loginNeedsTurnstile(config)) return null;
  if (loginTurnstileMisconfigured(config)) {
    return <Callout tone="danger" title="人机验证配置不完整">管理员启用了登录人机验证，但没有填写 site key，暂时无法用密码登录。请联系管理员。</Callout>;
  }
  return <TurnstileWidget siteKey={config.turnstile.site_key} action="login" onToken={onToken} resetKey={resetKey} loader={loader} />;
}
