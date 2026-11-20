import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { loginRequestSchema } from "@maillink/shared";
import { isApiError } from "../../api/errors";
import { api } from "../../api/instance";
import { sessionQuery } from "../../api/queries";
import { queryClient } from "../../app/query-client";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { fieldErrorsFromZod } from "../../lib/forms";
import type { FieldErrors } from "../../lib/forms";
import { describeError } from "../../lib/messages";
import { Button, Callout, ErrorCallout, TextField } from "../../ui";

const FIELDS = ["username", "password"] as const;
type Field = (typeof FIELDS)[number];

function useLogin() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (body: Parameters<typeof api.login>[0]) => {
      await api.login(body);
      // 以会话接口为准刷新缓存，再由 `/` 按角色分流
      await queryClient.fetchQuery({ ...sessionQuery(), staleTime: 0 });
    },
    onSuccess: () => navigate({ to: "/" }),
  });
}

/** 凭据错误统一一句话（后端也不区分原因）；网络与服务器错误分别说明并带错误码 */
function LoginError({ error }: { error: unknown }) {
  if (isApiError(error, "invalid_credentials")) {
    return <Callout tone="danger" title="登录失败">用户名或密码错误。</Callout>;
  }
  const { message, detail } = describeError(error);
  const title = isApiError(error) ? "服务器出错" : "无法连接服务器";
  return <ErrorCallout title={title} message={message} detail={detail} />;
}

export function LoginPage() {
  useDocumentTitle("登录");
  const login = useLogin();
  const [values, setValues] = useState<Record<Field, string>>({ username: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors<Field>>({});

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
    <>
      <h1>登录</h1>
      <form className="auth-form" onSubmit={submit} noValidate>
        <TextField label="用户名" autoComplete="username" autoFocus {...bind("username")} />
        <TextField label="密码" type="password" autoComplete="current-password" {...bind("password")} />
        {login.isError ? <LoginError error={login.error} /> : null}
        <Button type="submit" variant="primary" block busy={login.isPending} busyLabel="登录中…">
          登录
        </Button>
      </form>
    </>
  );
}
