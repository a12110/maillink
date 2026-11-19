import { useQuery } from "@tanstack/react-query";
import { meQuery } from "../../api/queries";
import { describeError } from "../../lib/messages";
import { PageHeader } from "../../shell/PageHeader";
import { ErrorCallout } from "../../ui";
import { PasswordSection } from "./PasswordSection";
import { ProfileSection } from "./ProfileSection";
import { SessionsSection } from "./SessionsSection";

/** 账号安全：本里程碑做资料、密码、登录会话；两步验证 / 通行密钥 / 第三方账号随 M5 */
export function AccountPage() {
  const me = useQuery(meQuery());
  return (
    <>
      <PageHeader title="账号安全" />
      <div className="page-narrow">
        {me.isError ? (
          <ErrorCallout title="账号资料加载失败" {...describeError(me.error)} onRetry={() => void me.refetch()} />
        ) : me.data ? (
          <ProfileSection key={me.data.id} me={me.data} />
        ) : (
          <span className="skeleton" aria-label="加载中" />
        )}
        {me.data?.has_password === false ? null : <PasswordSection />}
        <SessionsSection />
      </div>
    </>
  );
}
