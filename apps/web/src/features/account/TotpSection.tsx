import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useReducer, useState } from "react";
import type { MeResponse } from "@maillink/shared";
import { api } from "../../api/instance";
import { publicConfigQuery, queryKeys } from "../../api/queries";
import { describeAuthError } from "../../lib/auth-messages";
import { Button, Callout, ErrorCallout, Status, useToast } from "../../ui";
import { RecoveryCodesPanel } from "./RecoveryCodesPanel";
import { TotpReauthDialog } from "./TotpReauthDialog";
import type { TotpAction } from "./TotpReauthDialog";
import { TotpSetupPanel } from "./TotpSetupPanel";
import { IDLE_TOTP_FLOW, totpFlowReducer } from "./totp-flow";

/** 恢复码剩得不多时提醒重新生成 */
const RECOVERY_LOW_THRESHOLD = 3;

function EnabledPanel({ me, onAction }: { me: MeResponse; onAction: (action: TotpAction) => void }) {
  const low = me.recovery_codes_remaining < RECOVERY_LOW_THRESHOLD;
  return (
    <>
      <div className="security-status">
        <Status tone="success">已启用</Status>
        <span>剩余恢复码 <b className="num">{me.recovery_codes_remaining}</b> 个</span>
      </div>
      {low ? (
        <Callout tone="warning" title={me.recovery_codes_remaining === 0 ? "恢复码已用完" : "恢复码所剩不多"}>
          丢失验证器时只能靠恢复码登录。建议现在重新生成一组。
        </Callout>
      ) : null}
      <div className="form-actions">
        <Button onClick={() => onAction("regenerate")}>重新生成恢复码</Button>
        <Button variant="danger-ghost" onClick={() => onAction("disable")}>关闭两步验证</Button>
      </div>
    </>
  );
}

export function TotpSection({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const siteName = useQuery(publicConfigQuery()).data?.site_name ?? "MailLink";
  const [flow, dispatch] = useReducer(totpFlowReducer, IDLE_TOTP_FLOW);
  const [action, setAction] = useState<TotpAction | null>(null);

  // 启用 / 关闭 2FA：资料（含恢复码数）、会话列表，以及会话本身（admin_2fa_required 引导条依赖它）一并刷新
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.me }),
      queryClient.invalidateQueries({ queryKey: queryKeys.session }),
    ]);
  const start = useMutation({ mutationFn: api.totpSetup, onSuccess: (setup) => dispatch({ type: "setup_started", setup }) });

  return (
    <section aria-labelledby="totp-title" className="security-block">
      <h2 className="section-heading" id="totp-title">两步验证</h2>
      <p className="section-lead">除密码外，登录时还要输入验证器应用里的一次性验证码。用通行密钥登录不再需要这一步。</p>
      {flow.phase === "codes" ? (
        <RecoveryCodesPanel codes={flow.codes} origin={flow.origin} siteName={siteName} username={me.username}
          onDone={() => dispatch({ type: "codes_acknowledged" })} />
      ) : flow.phase === "setup" ? (
        <TotpSetupPanel me={me} setup={{ secret: flow.secret, otpauth_uri: flow.otpauthUri }}
          onCancel={() => dispatch({ type: "setup_cancelled" })}
          onEnabled={(codes) => {
            dispatch({ type: "enabled", codes });
            void refresh();
          }} />
      ) : me.totp_enabled ? (
        <EnabledPanel me={me} onAction={setAction} />
      ) : (
        <>
          <div className="security-status"><Status tone="neutral">未启用</Status></div>
          {start.isError ? <ErrorCallout title="没能开始设置" {...describeAuthError(start.error)} /> : null}
          <div className="form-actions">
            <Button variant="primary" busy={start.isPending} busyLabel="准备中…" onClick={() => start.mutate()}>
              <ShieldCheck />启用两步验证
            </Button>
          </div>
        </>
      )}
      {action === null ? null : (
        <TotpReauthDialog action={action} hasPassword={me.has_password} onClose={() => setAction(null)}
          onDisabled={() => {
            setAction(null);
            toast.success("两步验证已关闭，其他设备上的登录会话已失效");
            void refresh();
          }}
          onRegenerated={(codes) => {
            setAction(null);
            dispatch({ type: "regenerated", codes });
            void refresh();
          }} />
      )}
    </section>
  );
}
