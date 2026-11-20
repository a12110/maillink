import { TURNSTILE_SECRET_MAX_LENGTH, TURNSTILE_SITE_KEY_MAX_LENGTH } from "@maillink/shared";
import type { TurnstileScope } from "@maillink/shared";
import { Callout, Status, TextField } from "../../ui";
import { bindText, CheckField, CheckGroup, toggled } from "./fields";
import { SettingsGroupForm } from "./SettingsGroupForm";
import type { FormContext } from "./SettingsGroupForm";

const SCOPE_OPTIONS: ReadonlyArray<{ value: TurnstileScope; label: string; hint?: string }> = [
  { value: "login", label: "登录" },
  { value: "register", label: "注册" },
  { value: "pickup", label: "取件页", hint: "只对单独开启了人机验证的取件链接生效；取件页是唯一会按需加载 Cloudflare 脚本的页面。" },
];

function TurnstileFields(context: FormContext<"turnstile">) {
  const { draft, update, errors, disabled, saved } = context;
  return (
    <>
      <CheckField label="启用 Turnstile" checked={draft.enabled} disabled={disabled}
        onChange={(event) => update({ enabled: event.target.checked })}
        hint="启用前要填好 site key、secret，并至少选一个作用范围，否则保存会被拒绝。" />
      <TextField label="Site key" mono maxLength={TURNSTILE_SITE_KEY_MAX_LENGTH} autoComplete="off" {...bindText(context, "site_key")} />
      <div className="field">
        <TextField label="Secret" type="password" mono autoComplete="new-password" maxLength={TURNSTILE_SECRET_MAX_LENGTH}
          placeholder={saved.secret_set ? "已设置，留空表示不修改" : "未设置"}
          hint="只能设置新值，不能清除；留空表示不修改。保存后不会再显示。" {...bindText(context, "secret")} />
        <Status tone={saved.secret_set ? "success" : "neutral"}>{saved.secret_set ? "Secret 已设置" : "Secret 未设置"}</Status>
      </div>
      <CheckGroup legend="作用范围" error={errors.scopes}>
        {SCOPE_OPTIONS.map((scope) => (
          <CheckField key={scope.value} label={scope.label} hint={scope.hint} disabled={disabled}
            checked={draft.scopes.includes(scope.value)}
            onChange={(event) => update({ scopes: toggled(draft.scopes, scope.value, event.target.checked) })} />
        ))}
      </CheckGroup>
      <Callout title="Cloudflare 后台的域名设置">
        服务端会校验 token 的主机名与 action：Turnstile 站点的域名要包含本站访问域名（PUBLIC_ORIGIN 的主机名），控件的 action 固定为 login / register / pickup。
      </Callout>
    </>
  );
}

export function TurnstileForm() {
  return <SettingsGroupForm group="turnstile">{(context) => <TurnstileFields {...context} />}</SettingsGroupForm>;
}
