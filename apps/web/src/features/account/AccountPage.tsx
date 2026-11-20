import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { meQuery, publicConfigQuery } from "../../api/queries";
import { describeError } from "../../lib/messages";
import { PageHeader } from "../../shell/PageHeader";
import { Callout, ErrorCallout } from "../../ui";
import { describeOAuthResult } from "../auth/oauth-results";
import { IdentitiesSection } from "./IdentitiesSection";
import { PasskeysSection } from "./PasskeysSection";
import { PasswordSection } from "./PasswordSection";
import { ProfileSection } from "./ProfileSection";
import { SessionsSection } from "./SessionsSection";
import { TotpSection } from "./TotpSection";

const routeApi = getRouteApi("/workspace/account");

/** 绑定第三方账号后回到 `/account?oauth=<结果码>&provider=<slug>`：显示结果，关闭后清掉地址栏参数 */
function OAuthResultNotice() {
  const search = routeApi.useSearch();
  const navigate = useNavigate();
  const config = useQuery(publicConfigQuery());
  if (search.oauth === undefined) return null;
  const providerName = search.provider === undefined ? null : (config.data?.oauth_providers.find((p) => p.slug === search.provider)?.name ?? search.provider);
  const outcome = describeOAuthResult(search.oauth, providerName);
  return (
    <Callout tone={outcome.tone} title={outcome.title}
      actions={<button type="button" className="text-action" onClick={() => void navigate({ to: "/account", search: {}, replace: true })}>知道了</button>}>
      {outcome.detail}
    </Callout>
  );
}

/** 账号安全（05 §3）：资料、密码、两步验证、通行密钥、第三方账号、登录会话 */
export function AccountPage() {
  const me = useQuery(meQuery());
  return (
    <>
      <PageHeader title="账号安全" />
      <div className="page-narrow">
        <OAuthResultNotice />
        {me.isError ? (
          <ErrorCallout title="账号资料加载失败" {...describeError(me.error)} onRetry={() => void me.refetch()} />
        ) : me.data ? (
          <ProfileSection key={me.data.id} me={me.data} />
        ) : (
          <span className="skeleton" aria-label="加载中" />
        )}
        {me.data?.has_password === false ? null : <PasswordSection />}
        {me.data ? (
          <>
            <TotpSection me={me.data} />
            <PasskeysSection me={me.data} />
          </>
        ) : null}
        <IdentitiesSection />
        <SessionsSection />
      </div>
    </>
  );
}
