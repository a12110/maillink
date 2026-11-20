import type { LoginMethod } from "@maillink/shared";
import { Callout } from "../../ui";
import { CheckField, CheckGroup, toggled } from "./fields";
import { SettingsGroupForm } from "./SettingsGroupForm";
import type { FormContext } from "./SettingsGroupForm";

const LOGIN_METHOD_LABELS: ReadonlyArray<{ value: LoginMethod; label: string }> = [
  { value: "password", label: "密码" },
  { value: "passkey", label: "通行密钥" },
  { value: "oauth", label: "第三方登录（OAuth）" },
];

function AuthFields({ draft, update, errors, disabled }: FormContext<"auth">) {
  const passwordOff = !draft.login_methods.includes("password");
  return (
    <>
      <CheckField label="开放注册" checked={draft.registration_enabled} disabled={disabled}
        onChange={(event) => update({ registration_enabled: event.target.checked })}
        hint="开启后任何人都能在 /register 自助注册（只需用户名和密码，邮箱可选且不验证）。新用户是普通用户，没有任何邮箱授权。" />
      {draft.registration_enabled && passwordOff ? (
        <Callout tone="warning" title="已开放注册，但没有允许密码登录">
          注册创建的是密码账号，密码登录关闭时注册会被拒绝。
        </Callout>
      ) : null}
      <CheckGroup legend="允许的登录方式" error={errors.login_methods}
        hint="至少保留一种。保存时会检查：必须有启用的管理员在开放的方式里还有可用凭据，否则拒绝保存，避免把管理员锁在系统外。">
        {LOGIN_METHOD_LABELS.map((method) => (
          <CheckField key={method.value} label={method.label} disabled={disabled}
            checked={draft.login_methods.includes(method.value)}
            onChange={(event) => update({ login_methods: toggled(draft.login_methods, method.value, event.target.checked) })} />
        ))}
      </CheckGroup>
      <CheckField label="第三方登录后仍需两步验证" checked={draft.oauth_require_2fa} disabled={disabled}
        onChange={(event) => update({ oauth_require_2fa: event.target.checked })}
        hint="开启后，已启用 TOTP 的用户即使用 OAuth 登录也要再输入验证码。" />
    </>
  );
}

export function AuthForm() {
  return <SettingsGroupForm group="auth">{(context) => <AuthFields {...context} />}</SettingsGroupForm>;
}
