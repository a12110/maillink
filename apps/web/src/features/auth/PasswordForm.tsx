import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { loginRequestSchema } from "@maillink/shared";
import type { PublicConfig } from "@maillink/shared";
import { api } from "../../api/instance";
import { fieldErrorsFromZod } from "../../lib/forms";
import type { FieldErrors } from "../../lib/forms";
import { Button, TextField } from "../../ui";
import type { TurnstileLoader } from "../turnstile/loader";
import { LoginTurnstile, loginNeedsTurnstile, loginTurnstileMisconfigured } from "./LoginTurnstile";

const FIELDS = ["username", "password"] as const;
type Field = (typeof FIELDS)[number];

type Props = {
  /** 公开配置；读取失败时为 undefined（此时不带 Turnstile，服务端若要求会回 turnstile_failed 并显示出来） */
  config: Pick<PublicConfig, "turnstile"> | undefined;
  loader?: TurnstileLoader;
  onMfaRequired: () => void;
  onFailure: (error: unknown) => void;
  onSuccess: () => Promise<void>;
  pending: (value: boolean) => void;
};

export function PasswordForm({ config, loader, onMfaRequired, onFailure, onSuccess, pending }: Props) {
  const [values, setValues] = useState<Record<Field, string>>({ username: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const needsToken = loginNeedsTurnstile(config);
  const blocked = needsToken && (loginTurnstileMisconfigured(config) || token === null);
  const login = useMutation({
    mutationFn: async (body: Parameters<typeof api.login>[0]) => {
      const result = await api.login(body);
      if (result.status === "mfa_required") return onMfaRequired();
      await onSuccess();
    },
    onMutate: () => pending(true),
    onSettled: () => pending(false),
    onError: (error) => {
      // token 一次性：无论因为什么失败都让控件重新出题
      setToken(null);
      setResetKey((key) => key + 1);
      onFailure(error);
    },
  });

  const bind = (name: Field) => ({
    name,
    value: values[name],
    error: errors[name],
    onChange: (event: ChangeEvent<HTMLInputElement>) => setValues({ ...values, [name]: event.target.value }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // 按钮已禁用，这里再挡一道（回车提交、脚本触发都不能绕过人机验证）
    if (blocked) return;
    const parsed = loginRequestSchema.safeParse({ ...values, ...(needsToken && token !== null ? { turnstile_token: token } : {}) });
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error, FIELDS).fields);
      return;
    }
    setErrors({});
    login.mutate(parsed.data);
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <TextField label="用户名" autoComplete="username" autoFocus {...bind("username")} />
      <TextField label="密码" type="password" autoComplete="current-password" {...bind("password")} />
      {config ? <LoginTurnstile config={config} loader={loader} onToken={setToken} resetKey={resetKey} /> : null}
      <Button type="submit" variant="primary" block busy={login.isPending} busyLabel="登录中…" disabled={blocked}>
        登录
      </Button>
    </form>
  );
}
