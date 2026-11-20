import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect, useReducer, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { loginRequestSchema } from "@maillink/shared";
import { api } from "../../api/instance";
import { publicConfigQuery, sessionQuery } from "../../api/queries";
import { queryClient } from "../../app/query-client";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { fieldErrorsFromZod } from "../../lib/forms";
import type { FieldErrors } from "../../lib/forms";
import { describeError } from "../../lib/messages";
import { browserWebAuthn } from "../../lib/webauthn";
import type { WebAuthnClient } from "../../lib/webauthn";
import { Button, ErrorCallout, TextField } from "../../ui";
import { AlternativeLogins } from "./AlternativeLogins";
import { INITIAL_LOGIN_STATE, loginReducer } from "./login-flow";
import type { LoginState } from "./login-flow";
import { LoginNotices } from "./LoginNotices";
import { MfaStep } from "./MfaStep";
import type { OAuthResultSearch } from "./search";

const FIELDS = ["username", "password"] as const;
type Field = (typeof FIELDS)[number];

const routeApi = getRouteApi("/auth/login");

/** 会话已发出后（密码、第二步、通行密钥通用）：以会话接口为准刷新缓存，再由 `/` 按角色分流 */
function useFinishLogin() {
  const navigate = useNavigate();
  return async () => {
    await queryClient.fetchQuery({ ...sessionQuery(), staleTime: 0 });
    await navigate({ to: "/" });
  };
}

/** OAuth 回跳带结果码时，直接进入对应状态（mfa_required 进第二步，其余显示原因） */
function initialState(search: OAuthResultSearch): LoginState {
  if (search.oauth === undefined) return INITIAL_LOGIN_STATE;
  return loginReducer(INITIAL_LOGIN_STATE, { type: "oauth_result", code: search.oauth, provider: search.provider ?? null });
}

type PasswordStepProps = { onMfaRequired: () => void; onFailure: (error: unknown) => void; onSuccess: () => Promise<void> };

function PasswordForm({ onMfaRequired, onFailure, onSuccess, pending }: PasswordStepProps & { pending: (value: boolean) => void }) {
  const [values, setValues] = useState<Record<Field, string>>({ username: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const login = useMutation({
    mutationFn: async (body: Parameters<typeof api.login>[0]) => {
      const result = await api.login(body);
      if (result.status === "mfa_required") return onMfaRequired();
      await onSuccess();
    },
    onMutate: () => pending(true),
    onSettled: () => pending(false),
    onError: onFailure,
  });

  const bind = (name: Field) => ({
    name,
    value: values[name],
    error: errors[name],
    onChange: (event: ChangeEvent<HTMLInputElement>) => setValues({ ...values, [name]: event.target.value }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = loginRequestSchema.safeParse(values);
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
      <Button type="submit" variant="primary" block busy={login.isPending} busyLabel="登录中…">
        登录
      </Button>
    </form>
  );
}

export function LoginPage({ webauthn = browserWebAuthn }: { webauthn?: WebAuthnClient }) {
  useDocumentTitle("登录");
  const search = routeApi.useSearch();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(loginReducer, search, initialState);
  const [passwordPending, setPasswordPending] = useState(false);
  const finishLogin = useFinishLogin();
  const config = useQuery(publicConfigQuery());

  // 结果码只读一次：清掉地址栏参数，刷新页面不会重复显示旧结果
  useEffect(() => {
    if (search.oauth !== undefined || search.provider !== undefined) void navigate({ to: "/login", search: {}, replace: true });
  }, [navigate, search.oauth, search.provider]);

  const providerName = (slug: string) => config.data?.oauth_providers.find((p) => p.slug === slug)?.name ?? null;
  const mfa = state.step.kind === "mfa";

  return (
    <>
      <h1>{mfa ? "两步验证" : "登录"}</h1>
      {mfa ? <p className="auth-lead">密码已通过。再完成一步验证才能登录。</p> : null}
      <LoginNotices notice={state.notice} providerName={providerName} />
      {state.step.kind === "mfa" ? (
        <MfaStep
          method={state.step.method}
          onMethodChange={(method) => dispatch({ type: "use_method", method })}
          onBack={() => dispatch({ type: "back_to_password" })}
          onSuccess={finishLogin}
          onFailure={(failure) => dispatch({ type: "mfa_failed", failure })}
        />
      ) : (
        <>
          <PasswordForm
            onMfaRequired={() => dispatch({ type: "mfa_required" })}
            onFailure={(error) => dispatch({ type: "password_failed", error })}
            onSuccess={finishLogin}
            pending={setPasswordPending}
          />
          {config.data ? (
            <AlternativeLogins config={config.data} webauthn={webauthn} disabled={passwordPending} onSuccess={finishLogin} />
          ) : config.isError ? (
            <ErrorCallout title="没能读取可用的登录方式" {...describeError(config.error)} onRetry={() => void config.refetch()} />
          ) : null}
        </>
      )}
    </>
  );
}
