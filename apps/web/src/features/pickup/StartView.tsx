import { useId } from "react";
import type { LinkPublicStatus } from "@maillink/shared";
import { PickupBar, PickupMain } from "../../shell/PickupShell";
import { Button, Callout } from "../../ui";
import { AddressBlock, PickupTitle, SiteNotice } from "./PickupHead";
import { PickupTurnstile } from "./PickupTurnstile";
import type { PickupApi } from "./pickup-api";
import { formatSpan } from "./time";
import { useStartForm } from "./useStartForm";

type StartViewProps = {
  token: string;
  status: LinkPublicStatus;
  api: Pick<PickupApi, "start">;
  onStarted: (status: LinkPublicStatus) => void;
  /** 设备已满 / 每日上限等不能就地解决的错误：交给页面重新取状态 */
  onBlocked: () => void;
};

function PasswordField({ value, onChange, invalid }: { value: string; onChange: (value: string) => void; invalid: boolean }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        访问口令
      </label>
      <input
        id={id}
        className="input"
        type="password"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="向卖家索取口令"
        value={value}
        aria-invalid={invalid ? "true" : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="field-hint">口令由卖家单独发给你，和链接不在同一条消息里。</p>
    </div>
  );
}

function TurnstileBlock({ status, epoch, onToken }: { status: LinkPublicStatus; epoch: number; onToken: (token: string | null) => void }) {
  const siteKey = status.turnstile.site_key;
  if (siteKey) return <PickupTurnstile key={epoch} siteKey={siteKey} onToken={onToken} />;
  return (
    <Callout tone="danger" title="人机验证暂不可用">
      这个链接需要人机验证，但站点还没有配置验证密钥（turnstile_not_configured）。请联系卖家。
    </Callout>
  );
}

/** 新访客：标题与卖家说明、口令、人机验证（需要时才加载脚本）、“开始取码” */
export function StartView(props: StartViewProps) {
  const { status } = props;
  const form = useStartForm(props);
  const expireSec = status.expire_after_first_access_sec;
  return (
    <form className="pk-form-wrap" onSubmit={(event) => void form.submit(event)} noValidate>
      <PickupMain>
        <SiteNotice notice={status.site.notice} />
        <PickupTitle status={status} lead={status.public_note} />
        <AddressBlock status={status} />
        {status.requires_password ? (
          <PasswordField value={form.password} onChange={form.setPassword} invalid={form.problem?.detail.startsWith("link_password") ?? false} />
        ) : null}
        {status.turnstile.required ? <TurnstileBlock status={status} epoch={form.epoch} onToken={form.setTurnstileToken} /> : null}
        {form.problem ? (
          <Callout tone="danger" title={form.problem.message}>
            {form.problem.detail}
          </Callout>
        ) : null}
        {expireSec === null ? null : <p className="pk-note">有效期从点击后开始计算，共 {formatSpan(expireSec)}，建议在需要登录时再点。</p>}
      </PickupMain>
      <PickupBar>
        <Button type="submit" variant="primary" size="lg" block disabled={!form.ready} busy={form.busy} busyLabel="正在验证…">
          开始取码
        </Button>
      </PickupBar>
    </form>
  );
}
